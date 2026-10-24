import { db, pool, transaction } from "./db.ts";
import { runOne, BlockedJob, RetryableJob } from "./jobs.ts";
import { OpenAIProvider } from "./ai.ts";
import { imageForVision, processMedia, registerMedia } from "./media.ts";
import { applyEggDefault, readiness } from "../shared/quantities.ts";
import sharp from "sharp";
import { normalizedImage } from "./image-input.ts";
import { fieldSources } from "../shared/provenance.ts";
import { store } from "./storage.ts";
export async function handleJob(
  job: any,
  providerFactory: (job: any) => any = (job) => new OpenAIProvider(job),
) {
  if (job.type === "media") return processMedia(job.payload.media_id);
  const ai = providerFactory(job);
  const p = job.payload;
  if (job.operation === "checkModels") {
    if (!process.env.OPENAI_API_KEY)
      throw new BlockedJob("מפתח OpenAI אינו מוגדר");
    return ai.checkModels();
  }
  if (job.operation === "extractRecipe") {
    const item = (
      await db.query("select * from kitchen.import_items where id=$1", [
        p.item_id,
      ])
    ).rows[0];
    if (
      !item ||
      ["saved", "merged", "trash"].includes(item.status) ||
      item.scan_generation !== (p.generation ?? 1)
    )
      return { skipped: true };
    const locked = await db.query(
      "update kitchen.import_items set status='processing',error=null where id=$1 and status not in ('saved','merged','trash') and scan_generation=$2 returning id",
      [item.id, p.generation ?? 1],
    );
    if (!locked.rows.length) return { skipped: true };
    const media = (
      await db.query(
        "select media_id from kitchen.import_media where item_id=$1 order by position",
        [item.id],
      )
    ).rows;
    const images = [];
    for (const m of media)
      images.push(
        await imageForVision(
          m.media_id,
          p.crop?.media_id === m.media_id ? p.crop.rect : undefined,
        ),
      );
    if (!images.length) throw Error("אין תמונות מקור לניתוח");
    const content = await ai.extractRecipe(images);
    content.ingredients = content.ingredients.map(applyEggDefault);
    // Persist the expensive extraction before attempting any secondary AI action.
    const checkpoint = await transaction(async (tx) => {
      const current = (
        await tx.query(
          "select * from kitchen.import_items where id=$1 for update",
          [item.id],
        )
      ).rows[0];
      if (
        !current ||
        ["saved", "merged", "trash"].includes(current.status) ||
        current.scan_generation !== (p.generation ?? 1)
      )
        return { skipped: true };
      const preserve = !!current.draft || current.revision !== p.revision;
      if (preserve)
        await tx.query(
          "update kitchen.import_items set previous_draft=$2,status='needs_review',updated_at=now() where id=$1",
          [item.id, JSON.stringify(content)],
        );
      else
        await tx.query(
          "update kitchen.import_items set draft=$2,status=$3,revision=revision+1,updated_at=now() where id=$1",
          [
            item.id,
            JSON.stringify(content),
            readiness(content).length
              ? "needs_review"
              : "waiting_classification",
          ],
        );
      if (!preserve)
        await tx.query(
          "update kitchen.import_items set field_sources=$2 where id=$1",
          [item.id, JSON.stringify(fieldSources(content, "source"))],
        );
      return { preserved_manual_draft: preserve };
    });
    if (checkpoint.skipped) return checkpoint;

    const categories = (
      await db.query("select id,parent_id,name,aliases from kitchen.categories")
    ).rows;
    let suggestions: any = null;
    try {
      const suggestionAI = providerFactory({
        ...job,
        operation: "suggestCategories",
      });
      suggestions = await suggestionAI.suggestCategories(content, categories);
    } catch (e) {
      suggestions = {
        paths: [],
        reason: "הצעת הסיווג אינה זמינה; אפשר לבחור מסלול ידנית",
        error: (e as Error).message,
      };
    }
    const current = (
      await db.query("select * from kitchen.import_items where id=$1", [
        item.id,
      ])
    ).rows[0];
    if (current.suggestions?.manual_paths)
      suggestions = {
        ...suggestions,
        manual_paths: current.suggestions.manual_paths,
      };
    const names = content.ingredients.map((i: any) => i.name).filter(Boolean);
    const similar = names.length
      ? (
          await db.query(
            "select r.id,r.title,count(*)::int overlap from kitchen.recipes r join kitchen.ingredients i on i.recipe_id=r.id where r.status='published' and i.name=any($1::text[]) group by r.id,r.title having count(*)>=2 order by count(*) desc limit 5",
            [names],
          )
        ).rows
      : [];
    if (similar.length)
      suggestions = { ...suggestions, possible_duplicates: similar };
    await db.query(
      "update kitchen.import_items set suggestions=$2::jsonb||(case when suggestions?'manual_paths' then jsonb_build_object('manual_paths',suggestions->'manual_paths') else '{}'::jsonb end),updated_at=now() where id=$1 and status not in ('saved','merged','trash')",
      [item.id, JSON.stringify(suggestions)],
    );
    return { item_id: item.id, ...checkpoint };
  }
  if (job.operation === "interpretSearch") return ai.interpretSearch(p.query);
  if (job.operation === "assistCooking") {
    const answer = await ai.assistCooking(p.context, p.question);
    await db.query(
      "update kitchen.assistant_messages set answer=$2 where job_id=$1",
      [job.id, JSON.stringify(answer)],
    );
    return answer;
  }
  if (job.operation === "mealSuggestion") {
    const result = await ai.suggestMeal(p.recipes, p.guests);
    const ids = new Set(p.recipes.map((r: any) => r.id));
    if (result.items.some((r: any) => !ids.has(r.recipe_id)))
      throw Error("הצעת ה-AI כללה מזהה שאינו במאגר שסופק ולכן נדחתה");
    return {
      ...result,
      items: result.items.map((r: any) => {
        const original = p.recipes.find((o: any) => o.id === r.recipe_id);
        return { ...r, title: original.title, yield: original.yield };
      }),
      candidate_count: p.recipes.length,
    };
  }
  if (job.operation === "transcribeAudio") {
    const m = (
      await db.query("select * from kitchen.media where id=$1", [p.media_id])
    ).rows[0];
    if (!m || m.kind !== "audio") throw Error("הקלטה אינה קיימת");
    if (m.state === "queued")
      throw new RetryableJob("ההקלטה עדיין עוברת בדיקת קובץ");
    if (m.state !== "ready")
      throw Error("עיבוד ההקלטה נכשל; לא נשלחה קריאת AI");
    return ai.transcribeAudio(await store.get(m.object_key), m.mime);
  }
  if (job.operation === "speakStep") {
    const bytes = await ai.speakText(p.text);
    const media = await registerMedia(db, bytes, "audio/wav", "ai", {
      model: process.env.SPEECH_MODEL || "gpt-realtime-2.1-mini",
      generated_voice: true,
    });
    return { audio_media_id: media.id, disclosure: "הקול נוצר באמצעות AI" };
  }
  if (job.operation === "categoryImage") {
    const c = (
      await db.query("select * from kitchen.categories where id=$1", [
        p.category_id,
      ])
    ).rows[0];
    if (
      !c ||
      c.manual_image ||
      c.media_id ||
      c.image_revision !== p.image_revision
    )
      return { skipped: true };
    const ancestors = (
      await db.query(
        "with recursive path as(select * from kitchen.categories where id=$1 union all select c.* from kitchen.categories c join path p on p.parent_id=c.id) select name from path",
        [c.id],
      )
    ).rows
      .map((r) => r.name)
      .reverse();
    const bytes = await ai.generateImage(
      `Natural appetizing food photograph representing category ${ancestors.join(" > ")}. Warm daylight, cream and sage styling, realistic dish, no text or lettering, simple square card composition. ${p.prompt || ""}`,
    );
    const media = await registerMedia(db, bytes, "image/webp", "ai", {
      model: process.env.IMAGE_GENERATION_MODEL || "gpt-image-2.5-flare",
      prompt_version: "category-1",
      category_id: c.id,
      illustration: true,
    });
    await db.query(
      "insert into kitchen.category_images(id,category_id,media_id,source) values(gen_random_uuid(),$1,$2,$3)",
      [c.id, media.id, "ai"],
    );
    await db.query(
      "update kitchen.categories set media_id=$2,image_state='ready' where id=$1 and manual_image=false and media_id is null and image_revision=$3",
      [c.id, media.id, p.image_revision],
    );
    return { media_id: media.id };
  }
  if (job.operation === "generateImage" || job.operation === "editImage") {
    let bytes: Buffer;
    if (job.operation === "editImage") {
      const m = (
        await db.query("select * from kitchen.media where id=$1", [p.media_id])
      ).rows[0];
      if (!m || m.kind !== "image") throw Error("נדרשת תמונה קיימת");
      const image = await normalizedImage(await store.get(m.object_key));
      bytes = await ai.editImage(
        image,
        `Improve lighting and background while preserving the dish as closely as possible. Exact preservation is not guaranteed. No text. ${p.prompt}`,
      );
    } else
      bytes = await ai.generateImage(
        `Realistic natural food photograph of the following recipe. Do not add conflicting main ingredients or change the dish shape. No text. ${JSON.stringify(p.content)} ${p.prompt}`,
      );
    const media = await registerMedia(db, bytes, "image/webp", "ai", {
      model:
        job.operation === "editImage"
          ? ai.client
            ? process.env.IMAGE_EDIT_MODEL || "gpt-image-2.5-sunburst"
            : ""
          : process.env.IMAGE_GENERATION_MODEL || "gpt-image-2.5-flare",
      prompt_version: "dish-1",
      parent_id: p.media_id ?? null,
      illustration: true,
    });
    if (p.media_id)
      await db.query("update kitchen.media set parent_id=$2 where id=$1", [
        media.id,
        p.media_id,
      ]);
    return { media_id: media.id, requires_user_choice: true };
  }
  throw Error("סוג עבודה לא נתמך");
}
let stopping = false;
export async function workerLoop() {
  while (!stopping) {
    const didWork = await runOne(handleJob).catch((e) => {
      console.error("worker_failure", { name: e.name });
      return false;
    });
    if (!didWork) await new Promise((r) => setTimeout(r, 1000));
  }
  await pool.end();
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/worker.ts")) {
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  void workerLoop();
}
