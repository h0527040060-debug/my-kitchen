import sharp from "sharp";
import { db } from "./db.ts";
import { registerMedia } from "./media.ts";
import { BlockedJob } from "./jobs.ts";
import { categoryTheme, categoryArtwork } from "../shared/category-themes.ts";
export async function handleCategoryImage(job: any) {
  const p = job.payload,
    c = (
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
  if (p.prompt?.trim())
    throw new BlockedJob(
      "תמונות הנושא המובנות זמינות; יצירה חדשה לפי הנחיה דורשת חיבור AI נפרד",
    );
  let bytes: Buffer, metadata: Record<string, unknown>;
  {
    const theme = categoryTheme(ancestors),
      input = new URL(
        `../public/category-illustrations/${theme.pack}.webp`,
        import.meta.url,
      );
    const meta = await sharp(input.pathname).metadata();
    const w = meta.width!,
      h = meta.height!,
      n = theme.columns;
    const left = Math.round(((theme.tile % n) * w) / n) + 3,
      top = Math.round((Math.floor(theme.tile / n) * h) / n) + 3;
    bytes = await sharp(input.pathname)
      .extract({
        left,
        top,
        width: Math.round((((theme.tile % n) + 1) * w) / n) - left - 3,
        height:
          Math.round(((Math.floor(theme.tile / n) + 1) * h) / n) - top - 3,
      })
      .resize(480, 480)
      .webp({ quality: 83 })
      .toBuffer();
    metadata = {
      ...categoryArtwork,
      source: "bundled_ai_illustration",
      theme: theme.pack + ":" + theme.tile,
      provider_api_call: false,
    };
  }
  const media = await registerMedia(db, bytes, "image/webp", "ai", {
    ...metadata,
    category_id: c.id,
    illustration: true,
  });
  await db.query(
    "insert into kitchen.category_images(id,category_id,media_id,source) values(gen_random_uuid(),$1,$2,'ai')",
    [c.id, media.id],
  );
  const result = await db.query(
    "update kitchen.categories set media_id=$2,image_state='ready' where id=$1 and manual_image=false and media_id is null and image_revision=$3 returning id",
    [c.id, media.id, p.image_revision],
  );
  return result.rows.length
    ? { media_id: media.id, library: true }
    : { skipped: true };
}
