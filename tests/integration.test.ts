import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import { db, pool, migrate, transaction } from "../server/db.ts";
import { createApp } from "../server/app.ts";
import { createOwner } from "../server/auth.ts";
import { ensureCloudOwner } from "../server/cloud-config.ts";
import { recipe } from "./fixture.ts";
import { enqueue, claim, recoverExpired, runOne } from "../server/jobs.ts";
import { categoryPaths } from "../server/recipes.ts";
import { LocalStore, store } from "../server/storage.ts";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { backupTo, restoreFrom } from "../server/backup.ts";
import { registerMedia, processMedia } from "../server/media.ts";
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/kitchen_test")
)
  throw Error("Integration tests require the dedicated kitchen_test database");
process.env.OPENAI_API_KEY = "";
process.env.AI_DAILY_MAX_CALLS = "0";
test("real PostgreSQL API, worker recovery, owner security and full media restore", async (t) => {
  await db.query("drop schema if exists kitchen cascade");
  await migrate();
  assert.equal(
    await transaction((tx) =>
      ensureCloudOwner(tx, {
        OWNER_EMAIL: "owner@example.test",
        OWNER_PASSWORD: "test-only-password-12345",
      }),
    ),
    true,
  );
  assert.equal(
    await transaction((tx) =>
      ensureCloudOwner(tx, {
        OWNER_EMAIL: "other@example.test",
        OWNER_PASSWORD: "must-not-overwrite-12345",
      }),
    ),
    false,
  );
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const origin = "http://127.0.0.1:" + (server.address() as any).port;
  let cookie = "";
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    auth = true,
  ) {
    const response = await fetch(origin + "/api" + path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(auth && cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data, headers: response.headers };
  }
  try {
    await t.test(
      "anonymous users cannot read data, media or enqueue AI; only the single owner can authenticate",
      async () => {
        for (const [path, method, body] of [
          ["/recipes", "GET", undefined],
          ["/media/" + randomUUID() + "/content", "GET", undefined],
          ["/ai/search", "POST", { query: "עוגה" }],
        ] as const)
          assert.equal((await request(path, method, body, false)).status, 401);
        assert.equal(
          (
            await request(
              "/login",
              "POST",
              { email: "owner@example.test", password: "wrong" },
              false,
            )
          ).status,
          401,
        );
        const login = await request(
          "/login",
          "POST",
          { email: "owner@example.test", password: "test-only-password-12345" },
          false,
        );
        assert.equal(login.status, 200);
        cookie = login.headers.get("set-cookie")!.split(";")[0];
        await assert.rejects(() =>
          createOwner(db, "second@example.test", "test-only-password-67890"),
        );
        const csrf = await fetch(origin + "/api/recipes", {
          method: "POST",
          headers: {
            cookie,
            origin: "https://attacker.example",
            "content-type": "application/json",
          },
          body: "{}",
        });
        assert.equal(csrf.status, 403);
      },
    );
    await t.test(
      "free-cloud limits are reported to the client and oversized uploads are rejected before object storage",
      async () => {
        const previous = process.env.CLOUD_PROFILE;
        try {
          process.env.CLOUD_PROFILE = "render-free";
          const settings = await request("/settings");
          assert.equal(settings.data.limits.image_mb, 10);
          assert.equal(settings.data.limits.upload_concurrency, 1);
          assert.equal(settings.data.hosting.may_sleep, true);
          await assert.rejects(
            () =>
              registerMedia(
                db,
                Buffer.alloc(10 * 1024 * 1024 + 1),
                "image/png",
                "personal",
              ),
            (e: any) => e.status === 400,
          );
        } finally {
          if (previous === undefined) delete process.env.CLOUD_PROFILE;
          else process.env.CLOUD_PROFILE = previous;
        }
      },
    );
    let rid = "",
      cat = "",
      cook = "";
    await t.test(
      "classification confirmation is mandatory; a shared branch creates one automatic image job",
      async () => {
        const c = await transaction((tx) =>
          categoryPaths(tx, [
            ["בישול", "תוספות"],
            ["בישול", "תוספות"],
          ]),
        );
        assert.equal(c.created_images, 2);
        cat = c.ids[0];
        assert.equal(
          (
            await db.query(
              "select * from kitchen.jobs where operation='categoryImage'",
            )
          ).rows.length,
          2,
        );
        const missing = await request("/recipes", "POST", {
          content: recipe(),
          status: "published",
          category_ids: [],
          confirm_categories: false,
        });
        assert.equal(missing.status, 422);
        const saved = await request("/recipes", "POST", {
          content: recipe(),
          status: "published",
          category_ids: [cat],
          confirm_categories: true,
        });
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        rid = saved.data.id;
        const manual = await request("/categories/" + cat, "PATCH", {
          name: "תוספות טובות",
          parent_id: (
            await db.query(
              "select parent_id from kitchen.categories where id=$1",
              [cat],
            )
          ).rows[0].parent_id,
          aliases: ["תוספת"],
        });
        assert.equal(manual.status, 200);
        assert.equal(
          (
            await db.query(
              "select * from kitchen.jobs where operation='categoryImage'",
            )
          ).rows.length,
          2,
        );
      },
    );
    await t.test(
      "cooking uses a fixed snapshot, persists checklists, and rejects stale recipe edits",
      async () => {
        const started = await request("/cooking", "POST", {
          recipe_id: rid,
          target: "8",
        });
        assert.equal(started.status, 200);
        cook = started.data.id;
        const current = (await request("/recipes/" + rid)).data.recipe;
        const changed = recipe();
        changed.title = "בדיקה סינתטית — כותרת מעודכנת";
        const update = await request("/recipes/" + rid, "PUT", {
          revision: current.revision,
          content: changed,
          status: "published",
          category_ids: [cat],
          confirm_categories: true,
        });
        assert.equal(update.status, 200);
        assert.equal(
          (
            await request("/recipes/" + rid, "PUT", {
              revision: current.revision,
              content: changed,
              status: "published",
              category_ids: [cat],
              confirm_categories: true,
            })
          ).status,
          409,
        );
        let c = (await request("/cooking/" + cook)).data.cooking;
        assert.notEqual(c.snapshot.title, changed.title);
        const first = c.snapshot.ingredients[0].id;
        const patch = await request("/cooking/" + cook, "PATCH", {
          revision: c.revision,
          checked_ingredients: [first],
          checked_steps: [],
          step_index: 0,
        });
        assert.equal(patch.status, 200);
        assert.deepEqual(
          (await request("/cooking/" + cook)).data.cooking.checked_ingredients,
          [first],
        );
        const second = await request("/cooking", "POST", {
          recipe_id: rid,
          target: "5",
        });
        assert.deepEqual(
          (await request("/cooking/" + second.data.id)).data.cooking
            .checked_ingredients,
          [],
        );
        c = (await request("/cooking/" + cook)).data.cooking;
        assert.equal(
          (
            await request("/cooking/" + cook, "PATCH", {
              revision: c.revision,
              checked_ingredients: [first],
              checked_steps: [],
              step_index: 0,
              target: "10",
            })
          ).status,
          409,
        );
        const done = await request("/cooking/" + cook + "/finish", "POST", {
          revision: c.revision,
          state: "completed",
          rating: 5,
          notes: "להפחית סוכר בכמות 8",
        });
        assert.equal(done.status, 200);
        await request("/cooking/" + cook + "/finish", "POST", {
          revision: c.revision,
          state: "completed",
          rating: 5,
          notes: "",
        });
        assert.equal(
          (await request("/recipes/" + rid)).data.recipe.cook_count,
          1,
        );
      },
    );
    await t.test(
      "meal snapshots, preparation and shopping preserve manual changes and linked quantities",
      async () => {
        const meal = (
          await request("/meals", "POST", {
            name: "בדיקה סינתטית — ארוחת שבת",
            scheduled_at: null,
            adults: 2,
            children: 1,
            style: "ביתי",
            notes: "",
          })
        ).data;
        for (const target of ["8", "5"]) {
          const current = (await request("/meals/" + meal.id)).data.meal;
          const added = await request("/meals/" + meal.id + "/items", "POST", {
            recipe_id: rid,
            target,
            meal_revision: current.revision,
          });
          assert.equal(added.status, 200, JSON.stringify(added.data));
        }
        const planning = await request(
          "/meals/" + meal.id + "/preparation",
          "POST",
          {
            anchor: "2026-10-24T10:00:00Z",
            anchor_type: "start",
            equipment: { תנור: 1 },
          },
        );
        assert.equal(planning.status, 200, JSON.stringify(planning.data));
        assert.equal(planning.data.plan.tasks.length, 2);
        assert.notEqual(
          planning.data.plan.tasks[0].id,
          planning.data.plan.tasks[1].id,
        );
        const shopping = await request("/shopping", "POST", {
          name: "בדיקה סינתטית — קניות",
          meal_id: meal.id,
        });
        assert.equal(shopping.status, 200);
        const list = (await request("/shopping/" + shopping.data.id)).data;
        const flour = list.items.find((i: any) => i.name === "קמח");
        assert.equal(flour.amount.low, "5200");
        assert.equal(flour.source_refs.length, 2);
        assert.equal(
          (
            await request("/shopping-items/" + flour.id, "PATCH", {
              revision: flour.revision,
              name: "קמח לפי הבחירה שלי",
              unit: flour.unit,
              amount: flour.amount,
              department: "אפייה",
              state: "at_home",
            })
          ).status,
          200,
        );
        const preview = (
          await request(
            "/shopping/" + shopping.data.id + "/refresh-preview",
            "POST",
            {},
          )
        ).data;
        assert.ok(
          preview.existing.some(
            (i: any) =>
              i.name === "קמח לפי הבחירה שלי" && i.state === "at_home",
          ),
        );
        assert.equal(
          (
            await request(
              "/shopping/" + shopping.data.id + "/refresh-apply",
              "POST",
              {
                confirmed: true,
                revision: preview.list_revision,
                remove_ids: [],
                add: [],
              },
            )
          ).status,
          200,
        );
        const unchanged = (
          await request("/shopping/" + shopping.data.id)
        ).data.items.find((i: any) => i.id === flour.id);
        assert.equal(unchanged.name, "קמח לפי הבחירה שלי");
        assert.equal(unchanged.state, "at_home");
      },
    );
    await t.test(
      "test-provider rescan preserves manual corrections, readable sources and manual category images",
      async () => {
        const bytes = await sharp({
          create: {
            width: 1200,
            height: 1800,
            channels: 3,
            background: "#78896a",
          },
        })
          .png()
          .toBuffer();
        const form = new FormData();
        form.append(
          "file",
          new Blob([bytes], { type: "image/png" }),
          "synthetic-not-ocr-evidence.png",
        );
        const response = await fetch(origin + "/api/imports/upload", {
          method: "POST",
          headers: { cookie },
          body: form,
        });
        assert.equal(response.status, 200);
        const uploaded = (await response.json()) as any;
        const firstJob = (
          await db.query(
            "select * from kitchen.jobs where payload->>'item_id'=$1 and operation='extractRecipe'",
            [uploaded.item.id],
          )
        ).rows[0];
        const { handleJob } = await import("../server/worker.ts");
        let candidate = recipe();
        const fake = () => ({
          extractRecipe: async (images: Buffer[]) => {
            assert.ok(images[0].length > 0);
            return structuredClone(candidate);
          },
          suggestCategories: async () => ({
            paths: [["בישול", "תוספות"]],
            reason: "ספק בדיקה בלבד",
            tags: [],
          }),
        });
        await handleJob(firstJob, fake);
        await db.query(
          "update kitchen.jobs set status='succeeded' where id=$1",
          [firstJob.id],
        );
        let item = (
          await db.query("select * from kitchen.import_items where id=$1", [
            uploaded.item.id,
          ])
        ).rows[0];
        const manual = structuredClone(item.draft);
        manual.ingredients[0].amount.low = "7";
        manual.ingredients[0].amount.text = "7";
        assert.equal(
          (
            await request("/imports/" + item.id, "PUT", {
              revision: item.revision,
              draft: manual,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request("/imports/" + item.id + "/classification", "PATCH", {
              paths: [["בישול", "תוספות טובות"]],
            })
          ).status,
          200,
        );
        const next = await request(
          "/imports/" + item.id + "/rescan",
          "POST",
          {},
        );
        candidate.ingredients[0].amount.low = "9";
        candidate.ingredients[0].amount.text = "9";
        const nextJob = (
          await db.query("select * from kitchen.jobs where id=$1", [
            next.data.id,
          ])
        ).rows[0];
        await handleJob(nextJob, fake);
        await db.query(
          "update kitchen.jobs set status='succeeded' where id=$1",
          [nextJob.id],
        );
        item = (
          await db.query("select * from kitchen.import_items where id=$1", [
            item.id,
          ])
        ).rows[0];
        assert.equal(item.draft.ingredients[0].amount.low, "7");
        assert.equal(item.previous_draft.ingredients[0].amount.low, "9");
        const source = (
          await db.query("select * from kitchen.media where id=$1", [
            uploaded.media_id,
          ])
        ).rows[0];
        assert.deepEqual(await store.get(source.object_key), bytes);
        await processMedia(source.id);
        assert.equal(
          (
            await db.query("select state from kitchen.media where id=$1", [
              source.id,
            ])
          ).rows[0].state,
          "ready",
        );
        assert.equal(
          (
            await request("/categories/" + cat + "/image", "POST", {
              media_id: source.id,
            })
          ).status,
          200,
        );
        const old = (
          await db.query(
            "select * from kitchen.jobs where operation='categoryImage' and payload->>'category_id'=$1",
            [cat],
          )
        ).rows[0];
        const skipped = await handleJob(old, () => ({
          generateImage: async () => {
            throw Error("must not call paid provider");
          },
        }));
        assert.equal((skipped as any).skipped, true);
        assert.equal(
          (
            await db.query(
              "select media_id from kitchen.categories where id=$1",
              [cat],
            )
          ).rows[0].media_id,
          source.id,
        );
        assert.equal(
          (
            await request(
              "/media/" + source.id + "/content?variant=original",
              "GET",
              undefined,
              false,
            )
          ).status,
          401,
        );
      },
    );
    await t.test(
      "FFmpeg actually transcodes a private video and creates a mobile poster",
      async () => {
        const root = await mkdtemp(join(tmpdir(), "kitchen-video-test-"));
        try {
          const path = join(root, "source.mp4");
          await promisify(execFile)(
            "ffmpeg",
            [
              "-y",
              "-f",
              "lavfi",
              "-i",
              "color=c=green:s=320x240:d=1",
              "-c:v",
              "libx264",
              "-pix_fmt",
              "yuv420p",
              path,
            ],
            { timeout: 30000, maxBuffer: 1024 * 1024 },
          );
          const bytes = await readFile(path);
          const media = await registerMedia(db, bytes, "video/mp4", "personal");
          await processMedia(media.id);
          const saved = (
            await db.query("select * from kitchen.media where id=$1", [
              media.id,
            ])
          ).rows[0];
          assert.equal(saved.metadata.processed, true);
          assert.ok(saved.derivatives.video && saved.derivatives.poster);
          assert.ok((await store.get(saved.derivatives.video)).length > 0);
          const poster = await sharp(
            await store.get(saved.derivatives.poster),
          ).metadata();
          assert.equal(poster.format, "jpeg");
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      },
    );
    await t.test(
      "recipe image requests are explicit and deduplicated; cropping retains AI illustration lineage",
      async () => {
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from kitchen.jobs where operation='generateImage'",
            )
          ).rows[0].n,
          0,
        );
        const call = async () => {
          const response = await fetch(
            origin + "/api/recipes/" + rid + "/image",
            {
              method: "POST",
              headers: {
                cookie,
                "Content-Type": "application/json",
                "Idempotency-Key": randomUUID(),
              },
              body: JSON.stringify({
                operation: "generateImage",
                prompt: "בדיקה בלבד — אין מפתח או מכסה",
              }),
            },
          );
          assert.equal(response.status, 200);
          return response.json() as any;
        };
        const first = await call(),
          second = await call();
        assert.equal(first.id, second.id);
        const bytes = await sharp({
          create: {
            width: 600,
            height: 400,
            channels: 3,
            background: "#b88366",
          },
        })
          .png()
          .toBuffer();
        const media = await registerMedia(db, bytes, "image/png", "ai", {
          test_fixture: true,
          illustration: true,
        });
        const cropped = await request("/media/" + media.id + "/crop", "POST", {
          left: 0,
          top: 0,
          width: 300,
          height: 200,
        });
        assert.equal(cropped.status, 200);
        assert.equal(cropped.data.origin, "ai");
        assert.equal(cropped.data.metadata.illustration, true);
        assert.equal(
          (
            await db.query("select parent_id from kitchen.media where id=$1", [
              cropped.data.id,
            ])
          ).rows[0].parent_id,
          media.id,
        );
      },
    );
    await t.test(
      "MediaRecorder-style live WebM audio is actually decoded and made playable without AI",
      async () => {
        const dir = await mkdtemp(join(tmpdir(), "kitchen-audio-test-"));
        try {
          const path = join(dir, "recording.webm");
          await promisify(execFile)(
            "ffmpeg",
            [
              "-y",
              "-f",
              "lavfi",
              "-i",
              "sine=frequency=440:duration=1",
              "-c:a",
              "libopus",
              "-f",
              "webm",
              "-live",
              "1",
              path,
            ],
            { timeout: 30000, maxBuffer: 1024 * 1024 },
          );
          const media = await registerMedia(
            db,
            await readFile(path),
            "audio/webm",
            "personal",
          );
          await processMedia(media.id);
          const result = (
            await db.query("select * from kitchen.media where id=$1", [
              media.id,
            ])
          ).rows[0];
          assert.equal(result.state, "ready");
          assert.ok(result.metadata.duration_seconds > 0);
          assert.ok((await store.get(result.derivatives.audio)).length > 0);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
    await t.test(
      "AI failures leave saved recipes and calculations available",
      async () => {
        const job = await enqueue(
          db,
          "ai",
          "interpretSearch",
          "no-key-" + randomUUID(),
          { query: "בלי מיקסר" },
        );
        const { handleJob } = await import("../server/worker.ts");
        for (let i = 0; i < 30; i++) {
          await runOne(handleJob);
          if (
            (
              await db.query("select status from kitchen.jobs where id=$1", [
                job.id,
              ])
            ).rows[0].status === "blocked"
          )
            break;
        }
        const state = (
          await db.query("select status from kitchen.jobs where id=$1", [
            job.id,
          ])
        ).rows[0];
        assert.equal(state.status, "blocked");
        assert.equal((await request("/recipes/" + rid)).status, 200);
      },
    );
    await t.test(
      "50 durable jobs recover after worker lease expiry without duplicate effects; dispatched AI becomes uncertain",
      async () => {
        for (let i = 0; i < 50; i++)
          await enqueue(db, "test", "effect", "test-" + i, { index: i });
        await db.query(
          "create table kitchen.test_effects(job_id uuid primary key)",
        );
        const crashing = spawn(
          process.execPath,
          ["--experimental-strip-types", "tests/queue-worker.ts", "crash"],
          { env: process.env, stdio: ["ignore", "ignore", "inherit", "ipc"] },
        );
        const claimed: any = await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("Worker did not claim")),
            10000,
          );
          crashing.once("message", (m) => {
            clearTimeout(timer);
            resolve(m);
          });
          crashing.once("error", reject);
        });
        crashing.kill("SIGKILL");
        await new Promise<void>((r) => crashing.once("exit", () => r()));
        await db.query(
          "update kitchen.jobs set lease_until=now()-interval '1 second' where id=$1",
          [claimed.claimed],
        );
        await recoverExpired(db);
        const restarted = spawn(
          process.execPath,
          ["--experimental-strip-types", "tests/queue-worker.ts", "run"],
          { env: process.env, stdio: "inherit" },
        );
        await new Promise<void>((resolve, reject) => {
          restarted.once("error", reject);
          restarted.once("exit", (code) =>
            code === 0 ? resolve() : reject(Error("Worker failed")),
          );
        });
        assert.equal(
          (await db.query("select count(*)::int n from kitchen.test_effects"))
            .rows[0].n,
          50,
        );
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from kitchen.jobs where type='test' and status='succeeded'",
            )
          ).rows[0].n,
          50,
        );
        const uncertain = await enqueue(
          db,
          "ai",
          "generateImage",
          "uncertain-" + randomUUID(),
          {},
        );
        await db.query(
          "update kitchen.jobs set status='running',dispatched=true,lease_until=now()-interval '1 second' where id=$1",
          [uncertain.id],
        );
        await recoverExpired(db);
        assert.equal(
          (
            await db.query("select status from kitchen.jobs where id=$1", [
              uncertain.id,
            ])
          ).rows[0].status,
          "uncertain",
        );
        assert.equal(
          (await request("/jobs/" + uncertain.id + "/retry", "POST", {}))
            .status,
          409,
        );
      },
    );
    await t.test(
      "media bytes and database are backed up, restored and usable in a new database",
      async () => {
        const root = await mkdtemp(join(tmpdir(), "kitchen-restore-"));
        const sourceStore = store;
        const bytes = await sharp({
          create: {
            width: 500,
            height: 350,
            channels: 3,
            background: "#789969",
          },
        })
          .png()
          .toBuffer();
        const media = await registerMedia(
          db,
          bytes,
          "image/png",
          "source",
          {},
          sourceStore,
        );
        await db.query(
          "insert into kitchen.recipe_media(recipe_id,media_id) values($1,$2)",
          [rid, media.id],
        );
        const client = await pool.connect();
        try {
          await backupTo(client, sourceStore, join(root, "backup"));
        } finally {
          client.release();
        }
        const admin = new pg.Pool({
          connectionString: process.env.DATABASE_URL,
        });
        await admin.query("drop database if exists kitchen_restore_test");
        await admin.query("create database kitchen_restore_test");
        const restorePool = new pg.Pool({
          connectionString: process.env.DATABASE_URL!.replace(
            "/kitchen_test",
            "/kitchen_restore_test",
          ),
        });
        const target = await restorePool.connect();
        try {
          await migrate(target);
          const restoredStore = new LocalStore(join(root, "restored-media"));
          const restored = await restoreFrom(
            target,
            restoredStore,
            join(root, "backup"),
          );
          assert.ok(restored.objects >= 7);
          assert.deepEqual(await restoredStore.get(media.object_key), bytes);
          assert.equal(
            (await target.query("select count(*)::int n from kitchen.recipes"))
              .rows[0].n,
            (await db.query("select count(*)::int n from kitchen.recipes"))
              .rows[0].n,
          );
          assert.equal(
            (await target.query("select count(*)::int n from kitchen.sessions"))
              .rows[0].n,
            0,
          );
          const restoredServer = spawn(
            process.execPath,
            ["--experimental-strip-types", "server/index.ts"],
            {
              env: {
                ...process.env,
                DATABASE_URL: process.env.DATABASE_URL!.replace(
                  "/kitchen_test",
                  "/kitchen_restore_test",
                ),
                PORT: "3002",
                APP_ORIGIN: "http://127.0.0.1:3002",
                MEDIA_ROOT: join(root, "restored-media"),
              },
              stdio: "ignore",
            },
          );
          try {
            let ready = false;
            for (let i = 0; i < 60; i++) {
              try {
                if ((await fetch("http://127.0.0.1:3002/api/health")).ok) {
                  ready = true;
                  break;
                }
              } catch {}
              await new Promise((r) => setTimeout(r, 200));
            }
            assert.ok(ready, "restored app boots");
            const login = await fetch("http://127.0.0.1:3002/api/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: "owner@example.test",
                password: "test-only-password-12345",
              }),
            });
            assert.equal(login.status, 200);
            const restoredCookie = login.headers
              .get("set-cookie")!
              .split(";")[0];
            const record = await fetch(
              "http://127.0.0.1:3002/api/recipes/" + rid,
              { headers: { cookie: restoredCookie } },
            );
            assert.equal(record.status, 200);
            const original = await fetch(
              "http://127.0.0.1:3002/api/media/" +
                media.id +
                "/content?variant=original",
              { headers: { cookie: restoredCookie } },
            );
            assert.equal(original.status, 200);
            assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
          } finally {
            restoredServer.kill("SIGTERM");
            await new Promise<void>((r) =>
              restoredServer.once("exit", () => r()),
            );
          }
          await assert.rejects(() =>
            restoreFrom(target, restoredStore, join(root, "backup")),
          );
        } finally {
          target.release();
          await restorePool.end();
          await admin.end();
          await rm(root, { recursive: true, force: true });
        }
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await pool.end();
  }
});
