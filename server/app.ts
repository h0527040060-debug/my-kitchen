import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { readFile, unlink, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolve } from "node:path";
import { db, transaction } from "./db.ts";
import { authMiddleware, digest, login, sameOrigin } from "./auth.ts";
import { HttpError, requireValue } from "./errors.ts";
import {
  categoryMove,
  categoryPaths,
  categoryPreview,
  getRecipe,
  saveRecipe,
} from "./recipes.ts";
import { enqueue } from "./jobs.ts";
import { MeasurementSchema, RecipeContentSchema } from "../shared/model.ts";
import { readiness, scaleRecipe, parseNumber } from "../shared/quantities.ts";
import {
  normalize,
  pantryMatches,
  preparationPlan,
  shoppingForRecipes,
} from "../shared/planning.ts";
import { registerMedia } from "./media.ts";
import { normalizedImage } from "./image-input.ts";
import { store } from "./storage.ts";
import { requestedImage } from "./ai-requests.ts";
import { modelConfig } from "./ai.ts";
import { fieldSources } from "../shared/provenance.ts";
import { prices } from "./pricing.ts";
import { measurementPreferences, insertShoppingLine } from "./shopping.ts";
import { mediaLimits, hostingInfo } from "./limits.ts";
import { chatIntakeRouter, ownerChatImportRouter, mergeChatDrafts } from "./chat-import.ts";
const uuid = z.string().uuid(),
  contentSchema = RecipeContentSchema;
const recipeSave = z.object({
  revision: z.number().int().optional(),
  content: contentSchema,
  status: z.enum(["draft", "published"]),
  category_ids: z.array(uuid),
  confirm_categories: z.boolean(),
  reason: z.string().max(500).optional(),
  measurement_config: MeasurementSchema.optional(),
});
const pathsSchema = z
  .array(z.array(z.string().min(1).max(100)).min(1).max(8))
  .min(1)
  .max(20);
const token = (req: express.Request) =>
  z.string().min(8).max(100).parse(req.get("idempotency-key"));
const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<any>) =>
  async (req: express.Request, res: express.Response) => {
    const result = await fn(req, res);
    if (!res.headersSent) res.json(result);
  };
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY_HOPS)
    app.set(
      "trust proxy",
      Math.min(3, Math.max(1, Number(process.env.TRUST_PROXY_HOPS) || 1)),
    );
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "blob:", "data:", "https://images.unsplash.com"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests:
            process.env.COOKIE_SECURE === "true" ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "3mb" }));
  app.use("/api", sameOrigin);
  app.get(
    "/api/health",
    wrap(async () => {
      await db.query("select 1");
      return { ok: true };
    }),
  );
  app.post(
    "/api/login",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 15,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    wrap(async (req, res) => {
      const b = z
        .object({ email: z.string().email(), password: z.string().max(256) })
        .parse(req.body);
      return login(db, b.email, b.password, res);
    }),
  );
  app.use("/api/chat-intake", chatIntakeRouter());
  app.use("/api", authMiddleware(db));
  app.use("/api/chat-import", ownerChatImportRouter());
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 600,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.get(
    "/api/session",
    wrap(async () => ({
      email: (await db.query("select email from kitchen.owner where id=1"))
        .rows[0].email,
    })),
  );
  app.post(
    "/api/logout",
    wrap(async (req, res) => {
      await db.query("delete from kitchen.sessions where token_hash=$1", [
        digest(req.cookies.kitchen_session),
      ]);
      res.clearCookie("kitchen_session", { path: "/" });
      return { ok: true };
    }),
  );
  app.get(
    "/api/settings",
    wrap(async () => {
      const owner = (
        await db.query("select preferences from kitchen.owner where id=1")
      ).rows[0];
      const usage = await db.query(
        "select operation,model,status,count(*)::int as count,sum(duration_ms) as duration_ms,sum(estimated_usd) as estimated_usd from kitchen.ai_usage where created_at>=date_trunc('day',now()) group by operation,model,status",
      );
      return {
        preferences: owner.preferences,
        ai: {
          configured: !!process.env.OPENAI_API_KEY,
          models: modelConfig,
          daily_max_calls: Number(process.env.AI_DAILY_MAX_CALLS || 0),
          usage: usage.rows,
          estimated_cost: prices()
            ? usage.rows.reduce((n, r) => n + Number(r.estimated_usd ?? 0), 0)
            : null,
          cost_note: prices()
            ? "עלות משוערת לפי טבלת המחירים שהוגדרה; אינה חיוב הספק בפועל"
            : "אין תעריפים מאומתים מוגדרים; ספירת קריאות אינה חיוב בפועל",
        },
        limits: mediaLimits(),
        hosting: hostingInfo(),
      };
    }),
  );
  app.put(
    "/api/settings",
    wrap(async (req) => {
      const preferences = z
        .object({
          ai_daily_limit: z.number().int().min(0).max(10000),
          cup_ml: z.number().min(1).max(1000).nullable(),
          package_weights: z.record(z.string(), z.number().positive()),
        })
        .parse(req.body);
      await db.query("update kitchen.owner set preferences=$1 where id=1", [
        JSON.stringify(preferences),
      ]);
      return { preferences };
    }),
  );
  app.get(
    "/api/sources",
    wrap(async () => ({
      items: (
        await db.query(
          "select content->>'source_name' as name,count(*)::int as count from kitchen.recipes where status='published' and content->>'source_name'<>'' group by content->>'source_name' order by name",
        )
      ).rows,
    })),
  );
  app.get(
    "/api/categories",
    wrap(async () => ({
      items: (await db.query("select * from kitchen.categories order by name"))
        .rows,
    })),
  );
  app.post(
    "/api/categories/preview",
    wrap(async (req) => categoryPreview(db, pathsSchema.parse(req.body.paths))),
  );
  app.post(
    "/api/categories",
    wrap(async (req) => {
      const b = z
        .object({
          paths: pathsSchema,
          confirmed: z.literal(true),
          expected_new_images: z.number().int().min(0),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        const preview = await categoryPreview(tx, b.paths);
        if (preview.new_images !== b.expected_new_images)
          throw new HttpError(
            409,
            "העץ השתנה. יש לבדוק מחדש את מספר התמונות החדשות",
            preview,
          );
        return categoryPaths(tx, b.paths);
      });
    }),
  );
  app.patch(
    "/api/categories/:id",
    wrap(async (req) => {
      const id = uuid.parse(req.params.id);
      const b = z
        .object({
          name: z.string().min(1).max(100),
          parent_id: uuid.nullable(),
          aliases: z.array(z.string().max(100)).max(30),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        await categoryMove(tx, id, b.parent_id);
        await tx.query(
          "update kitchen.categories set name=$2,normalized_name=$3,aliases=$4 where id=$1",
          [id, b.name, normalize(b.name), b.aliases],
        );
        return { ok: true };
      });
    }),
  );
  app.post(
    "/api/categories/:id/merge",
    wrap(async (req) => {
      const from = uuid.parse(req.params.id),
        to = uuid.parse(req.body.target_id);
      if (from === to) throw new HttpError(400, "יש לבחור ענף אחר");
      return transaction(async (tx) => {
        await categoryMove(tx, from, null);
        requireValue(
          (
            await tx.query("select id from kitchen.categories where id=$1", [
              to,
            ])
          ).rows[0],
        );
        const collision = await tx.query(
          "select 1 from kitchen.categories a join kitchen.categories b on a.normalized_name=b.normalized_name where a.parent_id=$1 and b.parent_id=$2",
          [from, to],
        );
        if (collision.rows.length)
          throw new HttpError(
            409,
            "יש ענפי משנה עם אותו שם. יש לאחד אותם תחילה",
          );
        const descendants = await tx.query(
          "with recursive branch as(select id from kitchen.categories where id=$1 union all select c.id from kitchen.categories c join branch b on c.parent_id=b.id) select 1 from branch where id=$2",
          [from, to],
        );
        if (descendants.rows.length)
          throw new HttpError(400, "אין למזג ענף לתוך צאצא שלו");
        await tx.query(
          "insert into kitchen.recipe_categories(recipe_id,category_id) select recipe_id,$2 from kitchen.recipe_categories where category_id=$1 on conflict do nothing",
          [from, to],
        );
        await tx.query(
          "delete from kitchen.recipe_categories where category_id=$1",
          [from],
        );
        await tx.query(
          "update kitchen.categories set parent_id=$2 where parent_id=$1",
          [from, to],
        );
        await tx.query(
          "update kitchen.category_images set category_id=$2 where category_id=$1",
          [from, to],
        );
        await tx.query("delete from kitchen.categories where id=$1", [from]);
        return { ok: true };
      });
    }),
  );
  app.post(
    "/api/categories/:id/edit-image",
    wrap(async (req) => {
      const c = requireValue(
        (
          await db.query("select * from kitchen.categories where id=$1", [
            uuid.parse(req.params.id),
          ])
        ).rows[0],
      );
      if (!c.media_id)
        throw new HttpError(422, "יש לבחור תמונת נושא לפני שיפור");
      const prompt = z.string().max(2000).parse(req.body.prompt);
      return transaction((tx) =>
        requestedImage(
          tx,
          "editImage",
          c.id,
          { category_id: c.id, recipe_id: c.id, media_id: c.media_id, prompt },
          `category-edit:${token(req)}`,
        ),
      );
    }),
  );
  app.get(
    "/api/categories/:id/images",
    wrap(async (req) => ({
      items: (
        await db.query(
          "select h.*,m.origin,m.metadata from kitchen.category_images h join kitchen.media m on m.id=h.media_id where category_id=$1 order by created_at desc",
          [uuid.parse(req.params.id)],
        )
      ).rows,
    })),
  );
  app.get(
    "/api/media",
    wrap(async (req) => ({
      items: (
        await db.query(
          "select id,kind,origin,caption,metadata,derivatives,state from kitchen.media where kind='image' order by created_at desc limit 30 offset $1",
          [Math.max(0, Number(req.query.offset) || 0)],
        )
      ).rows,
    })),
  );
  app.post(
    "/api/categories/:id/image",
    wrap(async (req) => {
      const id = uuid.parse(req.params.id);
      const b = z
        .object({
          media_id: uuid.nullable(),
          prompt: z.string().max(2000).default(""),
          regenerate: z.boolean().default(false),
        })
        .parse(req.body);
      if (b.media_id) {
        return transaction(async (tx) => {
          requireValue(
            (
              await tx.query(
                "select id from kitchen.media where id=$1 and kind='image'",
                [b.media_id],
              )
            ).rows[0],
          );
          requireValue(
            (
              await tx.query("select id from kitchen.categories where id=$1", [
                id,
              ])
            ).rows[0],
          );
          await tx.query(
            "insert into kitchen.category_images(id,category_id,media_id,source) values($1,$2,$3,$4)",
            [randomUUID(), id, b.media_id, "manual"],
          );
          await tx.query(
            "update kitchen.categories set media_id=$2,manual_image=true,image_state='ready' where id=$1",
            [id, b.media_id],
          );
          return { ok: true };
        });
      }
      return transaction(async (tx) => {
        const c = requireValue(
          (
            await tx.query(
              "select * from kitchen.categories where id=$1 for update",
              [id],
            )
          ).rows[0],
        );
        if (!b.regenerate) throw new HttpError(400, "נדרשת בקשת יצירה מפורשת");
        const revision = c.image_revision + 1;
        await tx.query(
          "update kitchen.categories set media_id=null,manual_image=false,image_state='pending',image_revision=$2 where id=$1",
          [id, revision],
        );
        return enqueue(
          tx,
          "ai",
          "categoryImage",
          `category-image:${id}:${revision}`,
          {
            category_id: id,
            image_revision: revision,
            prompt: b.prompt,
            previous_media_id: c.media_id,
          },
        );
      });
    }),
  );
  app.get(
    "/api/recipes",
    wrap(async (req) => {
      const q = normalize(
          z
            .string()
            .max(300)
            .parse(req.query.q ?? ""),
        ),
        limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24)),
        offset = Math.max(0, Number(req.query.offset) || 0);
      const params: any[] = [
        req.query.status === "draft"
          ? "draft"
          : req.query.status === "trash"
            ? "trash"
            : "published",
      ];
      const conditions = ["r.status=$1"];
      const add = (sql: string, v: any) => {
        params.push(v);
        conditions.push(sql.replace("?", `$${params.length}`));
      };
      if (q) add("r.search_text ilike ?", `%${q.replace(/[%_]/g, "\\$&")}%`);
      if (req.query.source)
        add(
          "r.content->>'source_name'=?",
          z.string().max(200).parse(req.query.source),
        );
      if (req.query.favorite === "true") conditions.push("r.favorite");
      if (req.query.category) {
        add(
          "exists(with recursive tree as(select id from kitchen.categories where id=?::uuid union all select c.id from kitchen.categories c join tree t on c.parent_id=t.id) select 1 from kitchen.recipe_categories rc join tree t on t.id=rc.category_id where rc.recipe_id=r.id)",
          uuid.parse(req.query.category),
        );
      }
      if (req.query.classification)
        add(
          "r.classification=?",
          z
            .enum(["בשרי", "חלבי", "פרווה", "לא ידוע"])
            .parse(req.query.classification),
        );
      if (req.query.tried === "yes") conditions.push("r.cook_count>0");
      if (req.query.tried === "no") conditions.push("r.cook_count=0");
      if (req.query.difficulty)
        add("r.difficulty=?", String(req.query.difficulty));
      if (req.query.tag) add("?=any(r.tags)", String(req.query.tag));
      if (req.query.max_active)
        add("r.active_minutes<=?", Number(req.query.max_active));
      if (req.query.max_total)
        add("r.total_minutes<=?", Number(req.query.max_total));
      if (req.query.natural_job) {
        const j = requireValue(
          (
            await db.query(
              "select result from kitchen.jobs where id=$1 and operation='interpretSearch' and status='succeeded'",
              [uuid.parse(req.query.natural_job)],
            )
          ).rows[0],
        );
        for (const t of j.result.terms)
          add("r.search_text ilike ?", `%${normalize(t)}%`);
        for (const t of j.result.excluded_terms)
          add("r.search_text not ilike ?", `%${normalize(t)}%`);
        for (const t of j.result.tags) add("?=any(r.tags)", t);
        if (j.result.max_active_minutes !== null)
          add("r.active_minutes<=?", j.result.max_active_minutes);
        if (j.result.max_total_minutes !== null)
          add("r.total_minutes<=?", j.result.max_total_minutes);
      }
      const sorts: Record<string, string> = {
        created: "r.created_at desc",
        updated: "r.updated_at desc",
        cooked: "r.last_cooked_at desc nulls last",
        popular: "r.cook_count desc",
        rating: "r.rating desc nulls last",
        name: "r.title",
      };
      const where = conditions.join(" and ");
      const total = (
        await db.query(
          `select count(*)::int as n from kitchen.recipes r where ${where}`,
          params,
        )
      ).rows[0].n;
      params.push(limit, offset);
      const rows = await db.query(
        `select r.id,r.title,r.revision,r.status,r.favorite,r.primary_media_id,(select origin from kitchen.media where id=r.primary_media_id) as primary_media_origin,r.active_minutes,r.total_minutes,r.cook_count,r.rating,r.classification,r.tags,r.created_at,r.updated_at,r.content->'yield' as yield,r.content->>'description' as description from kitchen.recipes r where ${where} order by ${sorts[String(req.query.sort)] ?? sorts.updated},r.id limit $${params.length - 1} offset $${params.length}`,
        params,
      );
      return { items: rows.rows, total, offset, limit };
    }),
  );
  app.get(
    "/api/recipes/:id",
    wrap(async (req) => {
      const id = uuid.parse(req.params.id);
      return {
        recipe: await getRecipe(db, id),
        media: (
          await db.query(
            "select m.*,rm.position from kitchen.media m join kitchen.recipe_media rm on rm.media_id=m.id where rm.recipe_id=$1 order by rm.position",
            [id],
          )
        ).rows,
        versions: (
          await db.query(
            "select id,revision,reason,created_at from kitchen.recipe_versions where recipe_id=$1 order by revision desc",
            [id],
          )
        ).rows,
        experiences: (
          await db.query(
            "select e.*,coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'origin',m.origin,'caption',m.caption,'state',m.state)) from kitchen.experience_media em join kitchen.media m on m.id=em.media_id where em.experience_id=e.id),'[]') as media from kitchen.experiences e where recipe_id=$1 order by created_at desc limit 20",
            [id],
          )
        ).rows,
      };
    }),
  );
  app.post(
    "/api/recipes",
    wrap(async (req) =>
      transaction((tx) => saveRecipe(tx, recipeSave.parse(req.body))),
    ),
  );
  app.put(
    "/api/recipes/:id",
    wrap(async (req) =>
      transaction((tx) =>
        saveRecipe(tx, {
          ...recipeSave.parse(req.body),
          id: uuid.parse(req.params.id),
        }),
      ),
    ),
  );
  app.post(
    "/api/recipes/:id/rescan",
    wrap(async (req) =>
      transaction(async (tx) => {
        const r = await getRecipe(tx, uuid.parse(req.params.id));
        const sources = (
          await tx.query(
            "select m.id,rm.position from kitchen.recipe_media rm join kitchen.media m on m.id=rm.media_id where rm.recipe_id=$1 and m.origin='source' order by rm.position",
            [r.id],
          )
        ).rows;
        if (!sources.length) throw new HttpError(422, "למתכון אין תמונות מקור");
        const id = randomUUID();
        await tx.query(
          "insert into kitchen.import_items(id,draft,recipe_id,base_recipe_revision) values($1,$2,$3,$4)",
          [id, JSON.stringify(r.content), r.id, r.revision],
        );
        for (const m of sources)
          await tx.query(
            "insert into kitchen.import_media(item_id,media_id,position) values($1,$2,$3)",
            [id, m.id, m.position],
          );
        await enqueue(tx, "ai", "extractRecipe", `extract:${id}:1`, {
          item_id: id,
          revision: 1,
        });
        return { id };
      }),
    ),
  );
  app.post(
    "/api/recipes/:id/restore-version",
    wrap(async (req) =>
      transaction(async (tx) => {
        const id = uuid.parse(req.params.id),
          current = await getRecipe(tx, id);
        const version = requireValue(
          (
            await tx.query(
              "select content,measurement_config from kitchen.recipe_versions where recipe_id=$1 and revision=$2",
              [id, z.number().int().parse(req.body.version)],
            )
          ).rows[0],
        );
        return saveRecipe(tx, {
          id,
          revision: z.number().int().parse(req.body.revision),
          content: version.content,
          measurement_config: version.measurement_config,
          status: "draft",
          category_ids: current.category_ids,
          confirm_categories: false,
          reason: `שחזור מגרסה ${req.body.version}`,
        });
      }),
    ),
  );
  app.patch(
    "/api/recipes/:id/favorite",
    wrap(async (req) => {
      const r = await db.query(
        "update kitchen.recipes set favorite=$2 where id=$1 returning id,favorite",
        [uuid.parse(req.params.id), z.boolean().parse(req.body.favorite)],
      );
      return requireValue(r.rows[0]);
    }),
  );
  app.delete(
    "/api/recipes/:id",
    wrap(async (req) => {
      z.literal(true).parse(req.body.confirmed);
      const r = await db.query(
        "update kitchen.recipes set status='trash',deleted_at=now(),revision=revision+1 where id=$1 and revision=$2 returning id",
        [uuid.parse(req.params.id), z.number().int().parse(req.body.revision)],
      );
      if (!r.rows.length) throw new HttpError(409, "המתכון השתנה או לא נמצא");
      return { ok: true };
    }),
  );
  app.post(
    "/api/recipes/:id/restore",
    wrap(async (req) => {
      await db.query(
        "update kitchen.recipes set status='draft',deleted_at=null,revision=revision+1 where id=$1 and status='trash'",
        [uuid.parse(req.params.id)],
      );
      return { ok: true };
    }),
  );
  app.post(
    "/api/recipes/:id/image",
    wrap(async (req) => {
      const id = uuid.parse(req.params.id),
        recipe = await getRecipe(db, id);
      const b = z
        .object({
          operation: z.enum(["generateImage", "editImage"]),
          prompt: z.string().max(2000),
          media_id: uuid.optional(),
        })
        .parse(req.body);
      if (b.operation === "editImage" && !b.media_id)
        throw new HttpError(400, "יש לבחור תמונה לעריכה");
      return transaction((tx) =>
        requestedImage(
          tx,
          b.operation,
          id,
          {
            ...b,
            recipe_id: id,
            content: recipe.content,
            recipe_revision: recipe.revision,
          },
          `recipe-ai:${token(req)}`,
        ),
      );
    }),
  );
  app.get(
    "/api/recipes/:id/versions/:revision",
    wrap(async (req) =>
      requireValue(
        (
          await db.query(
            "select * from kitchen.recipe_versions where recipe_id=$1 and revision=$2",
            [uuid.parse(req.params.id), Number(req.params.revision)],
          )
        ).rows[0],
      ),
    ),
  );
  const upload = multer({
    dest: process.env.UPLOAD_TMP || "data/uploads",
    limits: {
      files: 1,
      fileSize:
        Math.max(
          mediaLimits().image_mb,
          mediaLimits().video_mb,
          mediaLimits().audio_mb,
        ) *
        1024 *
        1024,
    },
  });
  app.post(
    "/api/media",
    upload.single("file"),
    wrap(async (req) => {
      if (!req.file) throw new HttpError(400, "יש לבחור קובץ");
      try {
        const bytes = await readFile(req.file.path);
        return await transaction((tx) =>
          registerMedia(tx, bytes, req.file!.mimetype, "personal"),
        );
      } finally {
        await unlink(req.file.path).catch(() => {});
      }
    }),
  );
  app.get(
    "/api/media/:id/content",
    wrap(async (req, res) => {
      const m = requireValue(
        (
          await db.query("select * from kitchen.media where id=$1", [
            uuid.parse(req.params.id),
          ])
        ).rows[0],
      );
      const variant = String(req.query.variant || "thumbnail");
      const key =
        variant === "original" ? m.object_key : m.derivatives[variant];
      if (!key)
        throw new HttpError(409, "המדיה עדיין מעובדת או שהגרסה אינה קיימת");
      const bytes = await store.get(key);
      const mime =
        variant === "original"
          ? m.mime
          : key.endsWith(".webp")
            ? "image/webp"
            : key.endsWith(".jpg")
              ? "image/jpeg"
              : key.endsWith(".mp3")
                ? "audio/mpeg"
                : "video/mp4";
      res.set({
        "Content-Type": mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
      });
      const range = req.get("range");
      if (range) {
        const parsed = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!parsed) {
          res.status(416).set("Content-Range", `bytes */${bytes.length}`).end();
          return;
        }
        const start = Number(parsed[1]),
          end = parsed[2]
            ? Math.min(Number(parsed[2]), bytes.length - 1)
            : bytes.length - 1;
        if (start > end || start >= bytes.length) {
          res.status(416).set("Content-Range", `bytes */${bytes.length}`).end();
          return;
        }
        res
          .status(206)
          .set({
            "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
            "Content-Length": String(end - start + 1),
          })
          .end(bytes.subarray(start, end + 1));
      } else res.set("Content-Length", String(bytes.length)).end(bytes);
    }),
  );
  app.patch(
    "/api/media/:id",
    wrap(async (req) => {
      const b = z.object({ caption: z.string().max(2000) }).parse(req.body);
      await db.query("update kitchen.media set caption=$2 where id=$1", [
        uuid.parse(req.params.id),
        b.caption,
      ]);
      return { ok: true };
    }),
  );
  app.post(
    "/api/media/:id/crop",
    wrap(async (req) => {
      const rect = z
        .object({
          left: z.number().int().min(0),
          top: z.number().int().min(0),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
        })
        .parse(req.body);
      const m = requireValue(
        (
          await db.query(
            "select * from kitchen.media where id=$1 and kind='image'",
            [uuid.parse(req.params.id)],
          )
        ).rows[0],
      );
      const sharp = (await import("sharp")).default;
      const bytes = await sharp(
        await normalizedImage(await store.get(m.object_key)),
      )
        .extract(rect)
        .jpeg({ quality: 95 })
        .toBuffer();
      const out = await registerMedia(
        db,
        bytes,
        "image/jpeg",
        m.origin === "ai" || m.metadata?.illustration ? "ai" : "personal",
        {
          crop: rect,
          parent_id: m.id,
          illustration: m.origin === "ai" || m.metadata?.illustration || false,
        },
      );
      await db.query("update kitchen.media set parent_id=$2 where id=$1", [
        out.id,
        m.id,
      ]);
      return out;
    }),
  );
  app.post(
    "/api/recipes/:id/media",
    wrap(async (req) => {
      const id = uuid.parse(req.params.id);
      await getRecipe(db, id);
      const b = z
        .object({
          media_id: uuid,
          primary: z.boolean(),
          position: z.number().int().min(0).default(0),
        })
        .parse(req.body);
      const m = requireValue(
        (
          await db.query("select * from kitchen.media where id=$1", [
            b.media_id,
          ])
        ).rows[0],
      );
      if (b.primary && m.kind !== "image")
        throw new HttpError(400, "תמונה ראשית חייבת להיות תמונה");
      return transaction(async (tx) => {
        await tx.query(
          "insert into kitchen.recipe_media(recipe_id,media_id,position) values($1,$2,$3) on conflict(recipe_id,media_id) do update set position=excluded.position",
          [id, b.media_id, b.position],
        );
        if (b.primary)
          await tx.query(
            "update kitchen.recipes set primary_media_id=$2 where id=$1",
            [id, b.media_id],
          );
        return { ok: true };
      });
    }),
  );
  app.post(
    "/api/imports/upload",
    upload.single("file"),
    wrap(async (req) => {
      if (!req.file || !req.file.mimetype.startsWith("image/")) {
        if (req.file) await unlink(req.file.path);
        throw new HttpError(400, "לייבוא מתכון נדרשת תמונה");
      }
      try {
        const bytes = await readFile(req.file.path);
        return transaction(async (tx) => {
          const media = await registerMedia(
            tx,
            bytes,
            req.file!.mimetype,
            "source",
          );
          const existing = await tx.query(
            "select i.* from kitchen.import_items i join kitchen.import_media m on m.item_id=i.id where m.media_id=$1 and i.status<>'merged' order by i.created_at limit 1",
            [media.id],
          );
          if (existing.rows.length)
            return { item: existing.rows[0], duplicate: true };
          const id = randomUUID();
          await tx.query("insert into kitchen.import_items(id) values($1)", [
            id,
          ]);
          await tx.query(
            "insert into kitchen.import_media(item_id,media_id,position) values($1,$2,0)",
            [id, media.id],
          );
          const job = await enqueue(
            tx,
            "ai",
            "extractRecipe",
            `extract:${id}:1`,
            { item_id: id, revision: 1 },
          );
          return {
            item: { id, status: "queued" },
            media_id: media.id,
            job,
            duplicate: false,
          };
        });
      } finally {
        await unlink(req.file.path).catch(() => {});
      }
    }),
  );
  app.post(
    "/api/imports/:id/split",
    wrap(async (req) =>
      transaction(async (tx) => {
        const item = requireValue(
          (
            await tx.query("select * from kitchen.import_items where id=$1", [
              uuid.parse(req.params.id),
            ])
          ).rows[0],
        );
        const id = randomUUID();
        const { emptyRecipe } = await import("../shared/model.ts");
        await tx.query(
          "insert into kitchen.import_items(id,status,draft) values($1,'needs_review',$2)",
          [id, JSON.stringify(emptyRecipe())],
        );
        await tx.query(
          "insert into kitchen.import_media(item_id,media_id,position) select $2,media_id,position from kitchen.import_media where item_id=$1",
          [item.id, id],
        );
        return { id };
      }),
    ),
  );
  app.post(
    "/api/voice/transcribe",
    wrap(async (req) => {
      const media_id = uuid.parse(req.body.media_id);
      requireValue(
        (
          await db.query(
            "select id from kitchen.media where id=$1 and kind='audio'",
            [media_id],
          )
        ).rows[0],
      );
      return enqueue(db, "ai", "transcribeAudio", `transcribe:${token(req)}`, {
        media_id,
      });
    }),
  );
  app.post(
    "/api/voice/speak",
    wrap(async (req) =>
      enqueue(db, "ai", "speakStep", `speech:${token(req)}`, {
        text: z.string().min(1).max(4096).parse(req.body.text),
      }),
    ),
  );
  app.get(
    "/api/imports",
    wrap(async (req) => {
      const offset = Math.max(0, Number(req.query.offset) || 0);
      return {
        items: (
          await db.query(
            "select i.*,coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'state',m.state,'metadata',m.metadata) order by im.position) from kitchen.import_media im join kitchen.media m on m.id=im.media_id where im.item_id=i.id),'[]') as media from kitchen.import_items i where status<>'merged' order by i.created_at desc limit 50 offset $1",
            [offset],
          )
        ).rows,
        total: (
          await db.query(
            "select count(*)::int n from kitchen.import_items where status<>'merged'",
          )
        ).rows[0].n,
        summary: (
          await db.query(
            "select status,count(*)::int n from kitchen.import_items group by status",
          )
        ).rows,
      };
    }),
  );
  app.patch(
    "/api/imports/:id/classification",
    wrap(async (req) => {
      const paths = z
        .array(z.array(z.string().min(1).max(100)).min(1).max(8))
        .max(20)
        .parse(req.body.paths);
      const item = requireValue(
        (
          await db.query("select * from kitchen.import_items where id=$1", [
            uuid.parse(req.params.id),
          ])
        ).rows[0],
      );
      const status =
        item.draft && !readiness(item.draft).length && paths.length
          ? "ready"
          : item.status;
      const result = await db.query(
        "update kitchen.import_items set suggestions=jsonb_set(coalesce(suggestions,'{}'::jsonb),'{manual_paths}',$2::jsonb),status=$3,updated_at=now() where id=$1 and status not in('saved','merged') returning id",
        [item.id, JSON.stringify(paths), status],
      );
      return requireValue(result.rows[0]);
    }),
  );
  app.put(
    "/api/imports/:id",
    wrap(async (req) => {
      const b = z
        .object({ revision: z.number().int(), draft: contentSchema })
        .parse(req.body);
      const previous = requireValue(
        (
          await db.query(
            "select draft,field_sources from kitchen.import_items where id=$1",
            [uuid.parse(req.params.id)],
          )
        ).rows[0],
      );
      const provenance = fieldSources(
        b.draft,
        "manual",
        previous.draft ?? undefined,
        previous.field_sources,
      );
      await db.query(
        "update kitchen.import_items set field_sources=$2 where id=$1 and revision=$3",
        [uuid.parse(req.params.id), JSON.stringify(provenance), b.revision],
      );
      const r = await db.query(
        "update kitchen.import_items set draft=$3,revision=revision+1,status='needs_review',updated_at=now() where id=$1 and revision=$2 and status<>'saved' returning *",
        [uuid.parse(req.params.id), b.revision, JSON.stringify(b.draft)],
      );
      if (!r.rows.length)
        throw new HttpError(409, "טיוטת הייבוא השתנתה; יש לטעון מחדש");
      return r.rows[0];
    }),
  );
  app.post(
    "/api/imports/group",
    wrap(async (req) => {
      const b = z
        .object({
          item_ids: z.array(uuid).min(2).max(10),
          media_order: z.array(uuid).min(2).max(20),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        const items = (
          await tx.query(
            "select * from kitchen.import_items where id=any($1::uuid[]) and status not in ('saved','merged','processing') for update",
            [b.item_ids],
          )
        ).rows;
        if (items.length !== b.item_ids.length)
          throw new HttpError(
            409,
            "אי אפשר לאחד פריט שנשמר או נמצא כעת בעיבוד",
          );
        const media = (
          await tx.query(
            "select distinct media_id from kitchen.import_media where item_id=any($1::uuid[])",
            [b.item_ids],
          )
        ).rows.map((r) => r.media_id);
        if (
          media.length !== b.media_order.length ||
          !media.every((id) => b.media_order.includes(id))
        )
          throw new HttpError(400, "סדר התמונות אינו תואם לקבוצה");
        if (items.every(i => i.suggestions?.chat_import && i.draft))
          return mergeChatDrafts(tx, items, b.media_order);
        const id = randomUUID();
        await tx.query("insert into kitchen.import_items(id) values($1)", [id]);
        for (const [position, m] of b.media_order.entries())
          await tx.query(
            "insert into kitchen.import_media(item_id,media_id,position) values($1,$2,$3)",
            [id, m, position],
          );
        await tx.query(
          "update kitchen.import_items set status='merged' where id=any($1::uuid[])",
          [b.item_ids],
        );
        await tx.query(
          "update kitchen.jobs set status='cancelled' where operation='extractRecipe' and payload->>'item_id'=any($1::text[]) and status in('queued','blocked')",
          [b.item_ids],
        );
        await enqueue(tx, "ai", "extractRecipe", `extract:${id}:1`, {
          item_id: id,
          revision: 1,
        });
        return { id };
      });
    }),
  );
  app.put(
    "/api/imports/:id/order",
    wrap(async (req) => {
      const b = z
        .object({
          revision: z.number().int(),
          media_ids: z.array(uuid).min(1).max(20),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        const item = requireValue(
          (
            await tx.query(
              "select * from kitchen.import_items where id=$1 for update",
              [uuid.parse(req.params.id)],
            )
          ).rows[0],
        );
        if (
          item.revision !== b.revision ||
          ["processing", "saved", "merged"].includes(item.status)
        )
          throw new HttpError(409, "הפריט השתנה או נמצא בעיבוד");
        const existing = (
          await tx.query(
            "select media_id from kitchen.import_media where item_id=$1",
            [item.id],
          )
        ).rows.map((r) => r.media_id);
        if (
          existing.length !== b.media_ids.length ||
          new Set(b.media_ids).size !== existing.length ||
          !existing.every((id) => b.media_ids.includes(id))
        )
          throw new HttpError(400, "סדר מקורות אינו תקין");
        for (const [position, m] of b.media_ids.entries())
          await tx.query(
            "update kitchen.import_media set position=$3 where item_id=$1 and media_id=$2",
            [item.id, m, position],
          );
        return (
          await tx.query(
            "update kitchen.import_items set revision=revision+1 where id=$1 returning revision",
            [item.id],
          )
        ).rows[0];
      });
    }),
  );
  app.post(
    "/api/imports/:id/rescan",
    wrap(async (req) => {
      const b = z
        .object({
          crop: z
            .object({
              media_id: uuid,
              rect: z.object({
                left: z.number().int().nonnegative(),
                top: z.number().int().nonnegative(),
                width: z.number().int().positive(),
                height: z.number().int().positive(),
              }),
            })
            .optional(),
          media_order: z.array(uuid).min(1).max(20).optional(),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        const item = requireValue(
          (
            await tx.query(
              "select * from kitchen.import_items where id=$1 and status not in('saved','merged') for update",
              [uuid.parse(req.params.id)],
            )
          ).rows[0],
        );
        if (item.status === "processing")
          throw new HttpError(
            409,
            "סריקה כבר בעבודה. יש להמתין לתוצאה לפני שליחה נוספת",
          );
        const uncertain = await tx.query(
          "select id from kitchen.jobs where operation='extractRecipe' and payload->>'item_id'=$1 and status='uncertain'",
          [item.id],
        );
        if (uncertain.rows.length)
          throw new HttpError(
            409,
            "תוצאת הסריקה הקודמת אינה ודאית. יש לאשר ניסיון נוסף במסך העבודות כדי להימנע מחיוב כפול בלתי מודע",
          );
        await tx.query(
          "update kitchen.jobs set status='cancelled' where operation='extractRecipe' and payload->>'item_id'=$1 and status in('queued','blocked','failed')",
          [item.id],
        );
        if (b.media_order) {
          const existing = (
            await tx.query(
              "select media_id from kitchen.import_media where item_id=$1",
              [item.id],
            )
          ).rows.map((r) => r.media_id);
          if (
            existing.length !== b.media_order.length ||
            !existing.every((id) => b.media_order!.includes(id))
          )
            throw new HttpError(400, "יש לכלול את כל תמונות המקור");
          for (const [position, m] of b.media_order.entries())
            await tx.query(
              "update kitchen.import_media set position=$3 where item_id=$1 and media_id=$2",
              [item.id, m, position],
            );
        }
        if (
          b.crop &&
          !(
            await tx.query(
              "select 1 from kitchen.import_media where item_id=$1 and media_id=$2",
              [item.id, b.crop.media_id],
            )
          ).rows.length
        )
          throw new HttpError(400, "תמונת החיתוך אינה חלק מהפריט");
        const revision = item.revision + 1;
        await tx.query(
          "update kitchen.import_items set revision=$2,scan_generation=scan_generation+1,status='queued' where id=$1",
          [item.id, revision],
        );
        return enqueue(
          tx,
          "ai",
          "extractRecipe",
          `extract:${item.id}:${revision}`,
          {
            item_id: item.id,
            revision,
            generation: item.scan_generation + 1,
            crop: b.crop,
          },
        );
      });
    }),
  );
  app.post(
    "/api/imports/approve",
    wrap(async (req) => {
      const row = z.object({
        id: uuid,
        revision: z.number().int(),
        content: contentSchema,
        paths: pathsSchema,
      });
      const b = z
        .object({
          confirmed: z.literal(true),
          expected_new_images: z.number().int().nonnegative(),
          items: z.array(row).min(1).max(50),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        await tx.query("select pg_advisory_xact_lock(746822)");
        const preview = await categoryPreview(
          tx,
          b.items.flatMap((i) => i.paths),
        );
        if (preview.new_images !== b.expected_new_images)
          throw new HttpError(
            409,
            "עץ הקטגוריות השתנה; יש לבדוק שוב את האישור",
            preview,
          );
        const results = [];
        for (const input of b.items) {
          const item = requireValue(
            (
              await tx.query(
                "select * from kitchen.import_items where id=$1 for update",
                [input.id],
              )
            ).rows[0],
          );
          if (item.status === "saved") {
            results.push({
              id: input.id,
              recipe_id: item.recipe_id,
              already_saved: true,
            });
            continue;
          }
          if (item.revision !== input.revision)
            throw new HttpError(409, "טיוטת ייבוא השתנתה; אין לדרוס אותה");
          const category = await categoryPaths(tx, input.paths);
          const recipe = await saveRecipe(tx, {
            content: input.content,
            status: "published",
            category_ids: category.ids,
            confirm_categories: true,
            reason: "אישור ייבוא תמונות",
            field_sources: item.field_sources,
            ...(item.recipe_id
              ? { id: item.recipe_id, revision: item.base_recipe_revision }
              : {}),
          });
          await tx.query(
            "insert into kitchen.recipe_media(recipe_id,media_id,position) select $2,media_id,position from kitchen.import_media where item_id=$1 on conflict(recipe_id,media_id) do nothing",
            [input.id, recipe.id],
          );
          await tx.query(
            "update kitchen.import_items set status='saved',recipe_id=$2,draft=$3,updated_at=now() where id=$1",
            [input.id, recipe.id, JSON.stringify(input.content)],
          );
          results.push({ id: input.id, recipe_id: recipe.id });
        }
        return { items: results, new_images: preview.new_images };
      });
    }),
  );
  app.get(
    "/api/jobs",
    wrap(async () => ({
      items: (
        await db.query(
          "select id,type,operation,status,attempts,max_attempts,error,provider_id,created_at,updated_at from kitchen.jobs order by created_at desc limit 100",
        )
      ).rows,
    })),
  );
  app.get(
    "/api/jobs/:id",
    wrap(async (req) =>
      requireValue(
        (
          await db.query(
            "select id,type,operation,status,attempts,max_attempts,error,result,provider_id,created_at,updated_at from kitchen.jobs where id=$1",
            [uuid.parse(req.params.id)],
          )
        ).rows[0],
      ),
    ),
  );
  app.post(
    "/api/jobs/:id/retry",
    wrap(async (req) => {
      const id = uuid.parse(req.params.id);
      return transaction(async (tx) => {
        const job = requireValue(
          (
            await tx.query(
              "select * from kitchen.jobs where id=$1 for update",
              [id],
            )
          ).rows[0],
        );
        if (!["failed", "blocked", "uncertain"].includes(job.status))
          throw new HttpError(409, "עבודה זו אינה ממתינה לניסיון חוזר");
        if (
          job.status === "uncertain" &&
          req.body.acknowledge_possible_charge !== true
        )
          throw new HttpError(
            409,
            "ייתכן שהספק כבר חייב על הפעולה. נדרש אישור מפורש לשליחה נוספת",
          );
        await tx.query(
          "update kitchen.jobs set status='queued',dispatched=false,run_after=now(),error=null,max_attempts=greatest(max_attempts,attempts+1) where id=$1",
          [id],
        );
        if (job.operation === "extractRecipe")
          await tx.query(
            "update kitchen.import_items set status='queued',error=null where id=$1 and status<>'saved'",
            [job.payload.item_id],
          );
        return { ok: true };
      });
    }),
  );
  app.post(
    "/api/ai/search",
    wrap(async (req) =>
      enqueue(db, "ai", "interpretSearch", `search:${token(req)}`, {
        query: z.string().min(1).max(500).parse(req.body.query),
      }),
    ),
  );
  app.post(
    "/api/ai/check",
    wrap(async (req) =>
      enqueue(db, "ai", "checkModels", `check:${token(req)}`, {}),
    ),
  );
  app.post(
    "/api/assistant",
    wrap(async (req) => {
      const b = z
        .object({
          recipe_id: uuid,
          cooking_id: uuid.optional(),
          question: z.string().min(1).max(3000),
          target: z.string().optional(),
          step_id: z.string().optional(),
        })
        .parse(req.body);
      const recipe = await getRecipe(db, b.recipe_id);
      const cooking = b.cooking_id
        ? requireValue(
            (
              await db.query(
                "select * from kitchen.cooking where id=$1 and recipe_id=$2",
                [b.cooking_id, b.recipe_id],
              )
            ).rows[0],
          )
        : null;
      const context = cooking
        ? {
            content: cooking.snapshot,
            target: cooking.target,
            step_index: cooking.step_index,
          }
        : {
            content: recipe.content,
            target: b.target ?? recipe.content.yield?.amount,
            step_id: b.step_id,
          };
      return transaction(async (tx) => {
        const job = await enqueue(
          tx,
          "ai",
          "assistCooking",
          `assistant:${token(req)}`,
          { context, question: b.question },
        );
        await tx.query(
          "insert into kitchen.assistant_messages(id,job_id,recipe_id,cooking_id,question) values($1,$2,$3,$4,$5) on conflict do nothing",
          [randomUUID(), job.id, b.recipe_id, b.cooking_id ?? null, b.question],
        );
        return job;
      });
    }),
  );
  app.get(
    "/api/cooking",
    wrap(async () => ({
      items: (
        await db.query(
          "select c.*,r.title from kitchen.cooking c join kitchen.recipes r on r.id=c.recipe_id order by c.created_at desc limit 50",
        )
      ).rows,
    })),
  );
  app.post(
    "/api/cooking",
    wrap(async (req) => {
      const b = z
        .object({ recipe_id: uuid, target: z.string().max(50) })
        .parse(req.body);
      const recipe = await getRecipe(db, b.recipe_id);
      if (recipe.status !== "published" || readiness(recipe.content).length)
        throw new HttpError(422, "יש לאשר מתכון ולהשלים תפוקת בסיס לפני בישול");
      scaleRecipe(recipe.content, b.target);
      const id = randomUUID();
      await db.query(
        "insert into kitchen.cooking(id,recipe_id,recipe_revision,snapshot,target) values($1,$2,$3,$4,$5)",
        [
          id,
          recipe.id,
          recipe.revision,
          JSON.stringify(recipe.content),
          b.target,
        ],
      );
      await db.query(
        "update kitchen.cooking set measurement_config=$2 where id=$1",
        [id, JSON.stringify(recipe.measurement_config)],
      );
      await db.query(
        "update kitchen.cooking set field_sources=$2 where id=$1",
        [id, JSON.stringify(recipe.field_sources)],
      );
      return { id };
    }),
  );
  app.get(
    "/api/cooking/:id",
    wrap(async (req) => {
      const id = uuid.parse(req.params.id);
      return {
        cooking: requireValue(
          (await db.query("select * from kitchen.cooking where id=$1", [id]))
            .rows[0],
        ),
        timers: (
          await db.query("select * from kitchen.timers where cooking_id=$1", [
            id,
          ])
        ).rows,
      };
    }),
  );
  app.patch(
    "/api/cooking/:id",
    wrap(async (req) => {
      const id = uuid.parse(req.params.id);
      const b = z
        .object({
          revision: z.number().int(),
          checked_ingredients: z.array(z.string()),
          checked_steps: z.array(z.string()),
          step_index: z.number().int().min(0),
          target: z.string().optional(),
          confirm_quantity_change: z.boolean().optional(),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        const c = requireValue(
          (
            await tx.query(
              "select * from kitchen.cooking where id=$1 and state='active' for update",
              [id],
            )
          ).rows[0],
        );
        if (b.target && b.target !== c.target) {
          if (!b.confirm_quantity_change)
            throw new HttpError(
              409,
              "ייתכן שכבר נמדדו מצרכים. יש לאשר שינוי כמויות",
            );
          scaleRecipe(c.snapshot, b.target);
        }
        if (
          b.checked_ingredients.some(
            (id) => !c.snapshot.ingredients.some((i: any) => i.id === id),
          ) ||
          b.checked_steps.some(
            (id) => !c.snapshot.steps.some((s: any) => s.id === id),
          ) ||
          b.step_index >= Math.max(1, c.snapshot.steps.length)
        )
          throw new HttpError(400, "סימון אינו שייך לגרסת הבישול");
        const r = await tx.query(
          "update kitchen.cooking set checked_ingredients=$3,checked_steps=$4,step_index=$5,target=$6,revision=revision+1 where id=$1 and revision=$2 returning *",
          [
            id,
            b.revision,
            b.checked_ingredients,
            b.checked_steps,
            b.step_index,
            b.target ?? c.target,
          ],
        );
        if (!r.rows.length)
          throw new HttpError(
            409,
            "מצב הבישול השתנה במכשיר אחר. יש לטעון מחדש",
          );
        return r.rows[0];
      });
    }),
  );
  app.post(
    "/api/cooking/:id/finish",
    wrap(async (req) => {
      const b = z
        .object({
          revision: z.number().int(),
          state: z.enum(["completed", "cancelled"]),
          rating: z.number().int().min(1).max(5).nullable(),
          notes: z.string().max(10000),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        const c = requireValue(
          (
            await tx.query(
              "select * from kitchen.cooking where id=$1 for update",
              [uuid.parse(req.params.id)],
            )
          ).rows[0],
        );
        if (c.state !== "active") return { already_finished: true };
        if (c.revision !== b.revision)
          throw new HttpError(409, "מצב הבישול השתנה. יש לטעון מחדש");
        await tx.query(
          "update kitchen.cooking set state=$2,rating=$3,notes=$4,finished_at=now(),revision=revision+1 where id=$1",
          [c.id, b.state, b.rating, b.notes],
        );
        if (b.state === "completed") {
          await tx.query(
            "insert into kitchen.experiences(id,cooking_id,recipe_id,recipe_revision,target,rating,notes) values($1,$2,$3,$4,$5,$6,$7)",
            [
              randomUUID(),
              c.id,
              c.recipe_id,
              c.recipe_revision,
              c.target,
              b.rating,
              b.notes,
            ],
          );
          await tx.query(
            "update kitchen.recipes set cook_count=cook_count+1,last_cooked_at=now(),rating=coalesce($2,rating) where id=$1",
            [c.recipe_id, b.rating],
          );
        }
        return { ok: true };
      });
    }),
  );
  app.patch(
    "/api/experiences/:id",
    wrap(async (req) => {
      const b = z
        .object({
          rating: z.number().int().min(1).max(5).nullable(),
          notes: z.string().max(10000),
          media_ids: z.array(uuid).max(30),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        const e = requireValue(
          (
            await tx.query(
              "update kitchen.experiences set rating=$2,notes=$3 where id=$1 returning *",
              [uuid.parse(req.params.id), b.rating, b.notes],
            )
          ).rows[0],
        );
        for (const m of b.media_ids)
          await tx.query(
            "insert into kitchen.experience_media(experience_id,media_id) values($1,$2) on conflict do nothing",
            [e.id, m],
          );
        await tx.query(
          "update kitchen.cooking set rating=$2,notes=$3 where id=$1",
          [e.cooking_id, b.rating, b.notes],
        );
        return e;
      });
    }),
  );
  app.post(
    "/api/cooking/:id/timers",
    wrap(async (req) => {
      const b = z
        .object({
          name: z.string().min(1).max(100),
          duration_seconds: z.number().int().positive().max(604800),
        })
        .parse(req.body);
      const id = randomUUID();
      requireValue(
        (
          await db.query(
            "select id from kitchen.cooking where id=$1 and state='active'",
            [uuid.parse(req.params.id)],
          )
        ).rows[0],
      );
      await db.query(
        "insert into kitchen.timers(id,cooking_id,name,duration_seconds,remaining_seconds) values($1,$2,$3,$4,$4)",
        [id, req.params.id, b.name, b.duration_seconds],
      );
      return { id };
    }),
  );
  app.patch(
    "/api/timers/:id",
    wrap(async (req) => {
      const b = z
        .object({
          action: z.enum(["start", "pause", "reset", "edit"]),
          name: z.string().min(1).max(100).optional(),
          duration_seconds: z.number().int().positive().max(604800).optional(),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        const t = requireValue(
          (
            await tx.query(
              "select * from kitchen.timers where id=$1 for update",
              [uuid.parse(req.params.id)],
            )
          ).rows[0],
        );
        if (b.action === "start")
          await tx.query(
            "update kitchen.timers set ends_at=now()+(remaining_seconds::text||' seconds')::interval,state='running' where id=$1 and state<>'running'",
            [t.id],
          );
        if (b.action === "pause")
          await tx.query(
            "update kitchen.timers set remaining_seconds=greatest(0,ceil(extract(epoch from(ends_at-now())))),ends_at=null,state='paused' where id=$1 and state='running'",
            [t.id],
          );
        if (b.action === "reset")
          await tx.query(
            "update kitchen.timers set remaining_seconds=duration_seconds,ends_at=null,state='paused' where id=$1",
            [t.id],
          );
        if (b.action === "edit") {
          if (!b.name || !b.duration_seconds)
            throw new HttpError(400, "יש להזין שם ומשך");
          await tx.query(
            "update kitchen.timers set name=$2,duration_seconds=$3,remaining_seconds=$3,ends_at=null,state='paused' where id=$1",
            [t.id, b.name, b.duration_seconds],
          );
        }
        return { ok: true };
      });
    }),
  );
  app.get(
    "/api/pantry",
    wrap(async () => ({
      items: (
        await db.query(
          "select * from kitchen.pantry order by use_soon desc,name",
        )
      ).rows,
    })),
  );
  app.put(
    "/api/pantry",
    wrap(async (req) => {
      const b = z
        .object({
          id: uuid.optional(),
          revision: z.number().int().optional(),
          name: z.string().min(1).max(100),
          amount: z.any().nullable(),
          unit: z.string().nullable(),
          staple: z.boolean(),
          use_soon: z.boolean(),
        })
        .parse(req.body);
      if (b.amount)
        b.amount = (await import("../shared/model.ts")).AmountSchema.parse(
          b.amount,
        );
      if (b.id) {
        if (!b.revision)
          throw new HttpError(409, "יש לטעון את הגרסה החדשה של המצרך");
        const r = await db.query(
          "update kitchen.pantry set amount=$3,unit=$4,staple=$5,use_soon=$6,revision=revision+1 where id=$1 and revision=$2 returning id",
          [
            b.id,
            b.revision,
            b.amount ? JSON.stringify(b.amount) : null,
            b.unit,
            b.staple,
            b.use_soon,
          ],
        );
        if (!r.rows.length) throw new HttpError(409, "המצרך השתנה במכשיר אחר");
        return { ok: true };
      }
      await db.query(
        "insert into kitchen.pantry(id,name,normalized_name,amount,unit,staple,use_soon) values($1,$2,$3,$4,$5,$6,$7) on conflict(normalized_name) do nothing",
        [
          randomUUID(),
          b.name,
          normalize(b.name),
          b.amount ? JSON.stringify(b.amount) : null,
          b.unit,
          b.staple,
          b.use_soon,
        ],
      );
      return { ok: true };
    }),
  );
  app.delete(
    "/api/pantry/:id",
    wrap(async (req) => {
      await db.query("delete from kitchen.pantry where id=$1", [
        uuid.parse(req.params.id),
      ]);
      return { ok: true };
    }),
  );
  app.get(
    "/api/pantry/matches",
    wrap(async () => {
      const recipes = (
          await db.query(
            "select id,content from kitchen.recipes where status='published'",
          )
        ).rows,
        pantry = (await db.query("select * from kitchen.pantry")).rows;
      return {
        items: pantryMatches(recipes, pantry),
        assumptions: pantry
          .filter((p) => p.staple)
          .map((p) => `${p.name} הוגדר כמצרך יסוד, ללא הנחת כמות`),
      };
    }),
  );
  app.get(
    "/api/meals",
    wrap(async () => ({
      items: (
        await db.query(
          "select * from kitchen.meals order by created_at desc limit 100",
        )
      ).rows,
    })),
  );
  app.post(
    "/api/meals",
    wrap(async (req) => {
      const b = z
        .object({
          name: z.string().min(1).max(200),
          scheduled_at: z.string().datetime().nullable(),
          adults: z.number().int().min(0).max(500),
          children: z.number().int().min(0).max(500),
          style: z.string().max(500),
          notes: z.string().max(10000),
        })
        .parse(req.body);
      const id = randomUUID();
      await db.query(
        "insert into kitchen.meals(id,name,scheduled_at,adults,children,style,notes) values($1,$2,$3,$4,$5,$6,$7)",
        [id, b.name, b.scheduled_at, b.adults, b.children, b.style, b.notes],
      );
      return { id };
    }),
  );
  app.get(
    "/api/meals/:id",
    wrap(async (req) => {
      const id = uuid.parse(req.params.id);
      return {
        meal: requireValue(
          (await db.query("select * from kitchen.meals where id=$1", [id]))
            .rows[0],
        ),
        items: (
          await db.query(
            "select * from kitchen.meal_items where meal_id=$1 order by position",
            [id],
          )
        ).rows,
        preparations: (
          await db.query(
            "select * from kitchen.preparation where meal_id=$1 order by created_at desc",
            [id],
          )
        ).rows,
      };
    }),
  );
  app.post(
    "/api/meals/:id/items",
    wrap(async (req) => {
      const b = z
        .object({
          recipe_id: uuid,
          target: z.string().max(50),
          meal_revision: z.number().int(),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        const r = await getRecipe(tx, b.recipe_id);
        if (r.status !== "published")
          throw new HttpError(422, "אפשר להוסיף רק מתכון מאושר");
        scaleRecipe(r.content, b.target);
        const meal = await tx.query(
          "update kitchen.meals set revision=revision+1 where id=$1 and revision=$2 returning id",
          [uuid.parse(req.params.id), b.meal_revision],
        );
        if (!meal.rows.length)
          throw new HttpError(409, "הארוחה השתנתה; יש לרענן");
        const id = randomUUID();
        await tx.query(
          "insert into kitchen.meal_items(id,meal_id,recipe_id,recipe_revision,snapshot,target,position) values($1,$2,$3,$4,$5,$6,(select count(*) from kitchen.meal_items where meal_id=$2))",
          [
            id,
            req.params.id,
            r.id,
            r.revision,
            JSON.stringify(r.content),
            b.target,
          ],
        );
        await tx.query(
          "update kitchen.meal_items set measurement_config=$2 where id=$1",
          [id, JSON.stringify(r.measurement_config)],
        );
        return { id };
      });
    }),
  );
  app.patch(
    "/api/meals/:id",
    wrap(async (req) => {
      const b = z
        .object({
          revision: z.number().int(),
          notes: z.string().max(10000),
          outcome: z.enum(["enough", "short", "leftovers"]).nullable(),
        })
        .parse(req.body);
      const result = await db.query(
        "update kitchen.meals set notes=$3,outcome=$4,revision=revision+1 where id=$1 and revision=$2 returning id",
        [uuid.parse(req.params.id), b.revision, b.notes, b.outcome],
      );
      if (!result.rows.length) throw new HttpError(409, "הארוחה השתנתה");
      return { ok: true };
    }),
  );
  app.patch(
    "/api/meal-items/:id",
    wrap(async (req) => {
      const target = z.string().max(50).parse(req.body.target);
      const item = requireValue(
        (
          await db.query("select * from kitchen.meal_items where id=$1", [
            uuid.parse(req.params.id),
          ])
        ).rows[0],
      );
      scaleRecipe(item.snapshot, target);
      await db.query("update kitchen.meal_items set target=$2 where id=$1", [
        item.id,
        target,
      ]);
      await db.query(
        "update kitchen.meals set revision=revision+1 where id=$1",
        [item.meal_id],
      );
      return { ok: true };
    }),
  );
  app.delete(
    "/api/meal-items/:id",
    wrap(async (req) => {
      const r = await db.query(
        "delete from kitchen.meal_items where id=$1 returning meal_id",
        [uuid.parse(req.params.id)],
      );
      if (r.rows[0])
        await db.query(
          "update kitchen.meals set revision=revision+1 where id=$1",
          [r.rows[0].meal_id],
        );
      return { ok: true };
    }),
  );
  app.post(
    "/api/meals/:id/duplicate",
    wrap(async (req) =>
      transaction(async (tx) => {
        const source = requireValue(
          (
            await tx.query("select * from kitchen.meals where id=$1", [
              uuid.parse(req.params.id),
            ])
          ).rows[0],
        );
        const id = randomUUID();
        await tx.query(
          "insert into kitchen.meals(id,name,adults,children,style,notes) values($1,$2,$3,$4,$5,$6)",
          [
            id,
            source.name + " — עותק",
            source.adults,
            source.children,
            source.style,
            source.notes,
          ],
        );
        await tx.query(
          "insert into kitchen.meal_items(id,meal_id,recipe_id,recipe_revision,snapshot,target,position,measurement_config) select gen_random_uuid(),$2,recipe_id,recipe_revision,snapshot,target,position,measurement_config from kitchen.meal_items where meal_id=$1",
          [source.id, id],
        );
        return { id };
      }),
    ),
  );
  app.post(
    "/api/meals/:id/suggest",
    wrap(async (req) => {
      const meal = requireValue(
        (
          await db.query("select * from kitchen.meals where id=$1", [
            uuid.parse(req.params.id),
          ])
        ).rows[0],
      );
      const recipes = (
        await db.query(
          "select id,title,classification,tags,content->'yield' as yield from kitchen.recipes where status='published' order by created_at desc limit 200",
        )
      ).rows;
      return enqueue(db, "ai", "mealSuggestion", `meal-ai:${token(req)}`, {
        recipes,
        guests: {
          adults: meal.adults,
          children: meal.children,
          style: meal.style,
        },
        meal_id: meal.id,
      });
    }),
  );
  app.post(
    "/api/meals/:id/accept-suggestion",
    wrap(async (req) => {
      const b = z
        .object({
          job_id: uuid,
          revision: z.number().int(),
          confirmed: z.literal(true),
          items: z
            .array(z.object({ recipe_id: uuid, target: z.string().min(1) }))
            .min(1)
            .max(30),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        const mealId = uuid.parse(req.params.id);
        if (
          (
            await tx.query(
              "select 1 from kitchen.meal_suggestion_acceptances where job_id=$1",
              [b.job_id],
            )
          ).rows.length
        )
          return { already_accepted: true };
        const j = requireValue(
          (
            await tx.query(
              "select result,payload from kitchen.jobs where id=$1 and operation='mealSuggestion' and status='succeeded'",
              [b.job_id],
            )
          ).rows[0],
        );
        if (
          j.payload.meal_id !== mealId ||
          b.items.some(
            (i) =>
              !j.result.items.some((r: any) => r.recipe_id === i.recipe_id),
          )
        )
          throw new HttpError(400, "הבחירה אינה חלק מהצעת הארוחה");
        const m = await tx.query(
          "update kitchen.meals set revision=revision+1 where id=$1 and revision=$2 returning id",
          [mealId, b.revision],
        );
        if (!m.rows.length) throw new HttpError(409, "הארוחה השתנתה");
        for (const item of b.items) {
          const r = await getRecipe(tx, item.recipe_id);
          if (r.status !== "published")
            throw new HttpError(422, "מתכון בהצעה אינו מאושר עוד");
          scaleRecipe(r.content, item.target);
          await tx.query(
            "insert into kitchen.meal_items(id,meal_id,recipe_id,recipe_revision,snapshot,target,position) values($1,$2,$3,$4,$5,$6,(select count(*) from kitchen.meal_items where meal_id=$2))",
            [
              randomUUID(),
              mealId,
              r.id,
              r.revision,
              JSON.stringify(r.content),
              item.target,
            ],
          );
        }
        await tx.query(
          "insert into kitchen.meal_suggestion_acceptances(job_id,meal_id) values($1,$2)",
          [b.job_id, mealId],
        );
        return { ok: true };
      });
    }),
  );
  app.post(
    "/api/meals/:id/preparation",
    wrap(async (req) => {
      const b = z
        .object({
          anchor: z.string().datetime(),
          anchor_type: z.enum(["start", "serve"]),
          equipment: z.record(z.string(), z.number().int().min(1).max(10)),
        })
        .parse(req.body);
      const rows = (
        await db.query("select * from kitchen.meal_items where meal_id=$1", [
          uuid.parse(req.params.id),
        ])
      ).rows;
      const plan = preparationPlan(
        rows.map((i) => ({
          id: i.id,
          recipe_id: i.recipe_id,
          content: i.snapshot,
          target: i.target,
        })),
        b.equipment,
        b.anchor,
        b.anchor_type,
      );
      const id = randomUUID();
      await db.query(
        "insert into kitchen.preparation(id,meal_id,plan) values($1,$2,$3)",
        [id, req.params.id, JSON.stringify(plan)],
      );
      return { id, plan };
    }),
  );
  app.patch(
    "/api/preparation/:id",
    wrap(async (req) => {
      const b = z
        .object({
          revision: z.number().int(),
          checked: z.array(z.string()),
          plan: z.any().optional(),
        })
        .parse(req.body);
      const current = requireValue(
        (
          await db.query("select * from kitchen.preparation where id=$1", [
            uuid.parse(req.params.id),
          ])
        ).rows[0],
      );
      const plan = b.plan ?? current.plan;
      if (
        !Array.isArray(plan.tasks) ||
        b.checked.some((id) => !plan.tasks.some((t: any) => t.id === id))
      )
        throw new HttpError(400, "תוכנית לא תקינה");
      const result = await db.query(
        "update kitchen.preparation set checked=$3,plan=$4,revision=revision+1 where id=$1 and revision=$2 returning id",
        [current.id, b.revision, b.checked, JSON.stringify(plan)],
      );
      if (!result.rows.length) throw new HttpError(409, "תוכנית ההכנה השתנתה");
      return { ok: true };
    }),
  );
  app.get(
    "/api/shopping",
    wrap(async () => ({
      items: (
        await db.query(
          "select * from kitchen.shopping_lists order by created_at desc limit 100",
        )
      ).rows,
    })),
  );
  app.get(
    "/api/shopping/:id",
    wrap(async (req) => {
      const id = uuid.parse(req.params.id),
        list = requireValue(
          (
            await db.query("select * from kitchen.shopping_lists where id=$1", [
              id,
            ])
          ).rows[0],
        ),
        items = (
          await db.query(
            "select * from kitchen.shopping_items where list_id=$1 order by department,position,id",
            [id],
          )
        ).rows;
      const ids = [
        ...new Set(
          items.flatMap((i) => i.source_refs.map((r: any) => r.recipe_id)),
        ),
      ];
      const titles = ids.length
        ? (
            await db.query(
              "select id,title from kitchen.recipes where id=any($1::uuid[])",
              [ids],
            )
          ).rows
        : [];
      return {
        list,
        items: items.map((i) => ({
          ...i,
          source_refs: i.source_refs.map((r: any) => ({
            ...r,
            title:
              titles.find((t) => t.id === r.recipe_id)?.title ?? "מתכון שמור",
          })),
        })),
      };
    }),
  );
  app.post(
    "/api/shopping",
    wrap(async (req) => {
      const b = z
        .object({
          name: z.string().min(1).max(200),
          meal_id: uuid.optional(),
          recipe_id: uuid.optional(),
          target: z.string().optional(),
        })
        .parse(req.body);
      let items: any[] = [];
      if (b.meal_id)
        items = (
          await db.query(
            "select recipe_id,snapshot as content,target,measurement_config from kitchen.meal_items where meal_id=$1",
            [b.meal_id],
          )
        ).rows;
      else if (b.recipe_id) {
        const r = await getRecipe(db, b.recipe_id);
        items = [
          {
            recipe_id: r.id,
            content: r.content,
            measurement_config: r.measurement_config,
            target: b.target ?? r.content.yield?.amount,
          },
        ];
      }
      const lines = shoppingForRecipes(items, await measurementPreferences(db));
      return transaction(async (tx) => {
        const id = randomUUID();
        await tx.query(
          "insert into kitchen.shopping_lists(id,name,meal_id) values($1,$2,$3)",
          [id, b.name, b.meal_id ?? null],
        );
        for (const [position, line] of lines.entries())
          await insertShoppingLine(tx, id, line, position);
        return { id };
      });
    }),
  );
  app.post(
    "/api/shopping/:id/items",
    wrap(async (req) => {
      const b = z
        .object({
          name: z.string().min(1).max(200),
          unit: z.string(),
          amount: (await import("../shared/model.ts")).AmountSchema,
          department: z.string().max(100),
        })
        .parse(req.body);
      const id = randomUUID();
      await db.query(
        "insert into kitchen.shopping_items(id,list_id,name,unit,amount,source_refs,department,manual) values($1,$2,$3,$4,$5,'[]',$6,true)",
        [
          id,
          uuid.parse(req.params.id),
          b.name,
          b.unit,
          JSON.stringify(b.amount),
          b.department,
        ],
      );
      return { id };
    }),
  );
  app.patch(
    "/api/shopping-items/:id",
    wrap(async (req) => {
      const b = z
        .object({
          revision: z.number().int(),
          name: z.string().min(1).max(200),
          unit: z.string(),
          amount: (await import("../shared/model.ts")).AmountSchema,
          department: z.string().max(100),
          state: z.enum(["needed", "at_home", "bought"]),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        const r = await tx.query(
          "update kitchen.shopping_items set name=$3,unit=$4,amount=$5,department=$6,state=$7,edited=true,revision=revision+1 where id=$1 and revision=$2 returning list_id",
          [
            uuid.parse(req.params.id),
            b.revision,
            b.name,
            b.unit,
            JSON.stringify(b.amount),
            b.department,
            b.state,
          ],
        );
        if (!r.rows.length)
          throw new HttpError(
            409,
            "שורת הקניות השתנתה במכשיר אחר. יש לטעון מחדש לפני עדכון",
          );
        await tx.query(
          "update kitchen.shopping_lists set revision=revision+1 where id=$1",
          [r.rows[0].list_id],
        );
        return { ok: true };
      });
    }),
  );
  app.post(
    "/api/shopping/:id/refresh-preview",
    wrap(async (req) => {
      const list = requireValue(
        (
          await db.query("select * from kitchen.shopping_lists where id=$1", [
            uuid.parse(req.params.id),
          ])
        ).rows[0],
      );
      if (!list.meal_id) throw new HttpError(400, "הרשימה אינה מחוברת לארוחה");
      const items = (
        await db.query(
          "select recipe_id,snapshot as content,target,measurement_config from kitchen.meal_items where meal_id=$1",
          [list.meal_id],
        )
      ).rows;
      return {
        list_revision: list.revision,
        proposed: shoppingForRecipes(items, await measurementPreferences(db)),
        existing: (
          await db.query(
            "select * from kitchen.shopping_items where list_id=$1",
            [list.id],
          )
        ).rows,
        note: "העדכון מוסיף שורות מוצעות בלבד; שורות ערוכות וסימונים נשמרים עד בחירתך",
      };
    }),
  );
  app.post(
    "/api/shopping/:id/refresh-apply",
    wrap(async (req) => {
      const b = z
        .object({
          confirmed: z.literal(true),
          revision: z.number().int(),
          remove_ids: z.array(uuid),
          add: z.array(
            z.object({
              name: z.string().min(1),
              unit: z.string(),
              amount: (await import("../shared/model.ts")).AmountSchema,
              source_refs: z.array(
                z.object({
                  recipe_id: uuid,
                  ingredient_id: z.string(),
                  target: z.string(),
                }),
              ),
              department: z.string(),
              assumptions: z.array(z.string()).default([]),
            }),
          ),
        })
        .parse(req.body);
      return transaction(async (tx) => {
        const id = uuid.parse(req.params.id);
        const locked = await tx.query(
          "update kitchen.shopping_lists set revision=revision+1 where id=$1 and revision=$2 returning id",
          [id, b.revision],
        );
        if (!locked.rows.length)
          throw new HttpError(
            409,
            "הרשימה השתנתה מאז בדיקת ההבדלים. יש לבדוק אותה מחדש",
          );
        for (const item of b.remove_ids)
          await tx.query(
            "delete from kitchen.shopping_items where id=$1 and list_id=$2",
            [item, id],
          );
        for (const line of b.add) await insertShoppingLine(tx, id, line);
        await tx.query(
          "update kitchen.shopping_lists set revision=revision+1 where id=$1",
          [id],
        );
        return { ok: true };
      });
    }),
  );
  app.get(
    "/api/export",
    wrap(async () => {
      const tables = [
        "categories",
        "recipes",
        "recipe_versions",
        "recipe_categories",
        "ingredients",
        "steps",
        "recipe_media",
        "media",
        "cooking",
        "timers",
        "meals",
        "meal_items",
        "preparation",
        "shopping_lists",
        "shopping_items",
        "pantry",
        "experiences",
        "experience_media",
        "import_items",
        "import_media",
        "chat_import_config",
        "chat_import_sources",
        "chat_import_records",
      ];
      const data: Record<string, any> = {};
      for (const t of tables)
        data[t] = (await db.query(`select * from kitchen.${t}`)).rows;
      return {
        format: "my-kitchen-export",
        version: 1,
        exported_at: new Date().toISOString(),
        data,
        note: "הייצוא כולל הפניות מדיה; לגיבוי הכולל את הקבצים עצמם יש להריץ npm run backup בשרת",
      };
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "הפעולה לא נמצאה" }),
  );
  app.use(express.static(resolve("dist"), { index: false }));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : error.code === "23505"
              ? 409
              : error instanceof multer.MulterError
                ? 400
                : 500;
      const message =
        status === 500
          ? "אירעה שגיאה בשרת. הפעולה לא הושלמה"
          : error instanceof z.ZodError
            ? "הנתונים שנשלחו אינם תקינים"
            : error.code === "23505"
              ? "רשומה עם אותו מזהה או שם כבר קיימת"
              : error.message;
      console.error("request_error", { status, name: error.name });
      res.status(status).json({
        error: message,
        details: error instanceof HttpError ? error.details : undefined,
      });
    },
  );
  return app;
}
