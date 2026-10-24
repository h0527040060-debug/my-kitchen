import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import pg from "pg";
import { db, pool, migrate } from "../server/db.ts";
import { createOwner, digest } from "../server/auth.ts";
import { createApp } from "../server/app.ts";
import { store, LocalStore } from "../server/storage.ts";
import { backupTo, restoreFrom } from "../server/backup.ts";
import { recipe } from "./fixture.ts";
import { ChatPackageSchema } from "../shared/chat-import.ts";

if (
  !process.env.DATABASE_URL ||
  new URL(process.env.DATABASE_URL).pathname !== "/kitchen_test"
)
  throw Error(
    "Chat intake integration resets only the dedicated kitchen_test database",
  );
process.env.OPENAI_API_KEY = "";
process.env.AI_DAILY_MAX_CALLS = "0";

test("chat and Drive intake: private drafts, durable deduplication and restore", async (t) => {
  await db.query("drop schema if exists kitchen cascade");
  await migrate();
  await createOwner(db, "owner@example.test", "test-only-password-12345");
  let server = createApp().listen(0, "127.0.0.1");
  const ready = async () => {
    await new Promise<void>((r) => server.once("listening", r));
    return "http://127.0.0.1:" + (server.address() as any).port;
  };
  let origin = await ready(),
    cookie = "";
  const token = randomBytes(32).toString("hex");
  await db.query(
    "insert into kitchen.chat_import_grants(token_hash,expires_at) values($1,now()+interval '30 minutes')",
    [digest(token)],
  );
  const processor = {
    kind: "chat_session",
    name: "Synthetic test",
    model: "fixture, no API call",
    prompt_version: "chat-import-he-v1",
  };
  async function req(
    path: string,
    method = "GET",
    body?: any,
    credential: string | null = token,
  ) {
    const r = await fetch(origin + "/api" + path, {
      method,
      headers: {
        ...(credential === cookie && cookie
          ? { cookie }
          : credential
            ? { authorization: "Bearer " + credential }
            : {}),
        ...(body !== undefined && !(body instanceof FormData)
          ? { "content-type": "application/json" }
          : {}),
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    return {
      status: r.status,
      data: await r.json().catch(() => ({})),
      headers: r.headers,
    };
  }
  async function login() {
    const r = await req(
      "/login",
      "POST",
      { email: "owner@example.test", password: "test-only-password-12345" },
      null,
    );
    assert.equal(r.status, 200);
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  }
  const bytes = await sharp({
    create: { width: 64, height: 80, channels: 3, background: "#658a69" },
  })
    .png()
    .toBuffer();
  const source = (key: string, image = bytes, provider = "drive") => ({
    key,
    provider,
    external_id: key,
    filename: key.replaceAll(":", "-") + ".png",
    sha256: createHash("sha256").update(image).digest("hex"),
  });
  async function upload(s: any, image = bytes) {
    const f = new FormData();
    f.set("source", JSON.stringify(s));
    f.set("file", new Blob([image], { type: "image/png" }), s.filename);
    return req("/chat-intake/sources", "POST", f);
  }
  const s = source("drive:first");
  const draft: any = {
    key: "draft:first",
    source_keys: [s.key],
    recipe_index: 0,
    content: recipe(),
    generated_fields: ["raw_text"],
    suggestions: { paths: [["בישול"]], reason: "נתוני בדיקה סינתטיים" },
  };
  let item = "",
    media = "";
  const close = () =>
    new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  try {
    await t.test(
      "untrusted callers and restricted grants cannot read recipes, invoke AI or publish",
      async () => {
        for (const path of ["/chat-intake/context", "/chat-intake/schema"])
          assert.equal((await req(path, "GET", undefined, null)).status, 401);
        assert.equal((await req("/recipes")).status, 401);
        assert.equal(
          (await req("/ai/search", "POST", { query: "סלט" })).status,
          401,
        );
        assert.equal(
          (await req("/chat-intake/publish", "POST", {})).status,
          404,
        );
        assert.equal(
          (await req("/chat-intake/context", "GET", undefined, "0".repeat(64)))
            .status,
          401,
        );
        const expired = randomBytes(32).toString("hex");
        await db.query(
          "insert into kitchen.chat_import_grants(token_hash,created_at,expires_at) values($1,now()-interval '2 hours',now()-interval '1 hour')",
          [digest(expired)],
        );
        assert.equal(
          (await req("/chat-intake/context", "GET", undefined, expired)).status,
          401,
        );
        const revoked = randomBytes(32).toString("hex");
        await db.query(
          "insert into kitchen.chat_import_grants(token_hash,expires_at,revoked) values($1,now()+interval '5 minutes',true)",
          [digest(revoked)],
        );
        assert.equal(
          (await req("/chat-intake/context", "GET", undefined, revoked)).status,
          401,
        );
        assert.equal(
          (
            await req("/chat-intake/drafts", "POST", {
              processor,
              item: { ...draft, confirmed: true },
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "source checksum and actual image format are validated; retries and both channels reuse the original",
      async () => {
        assert.equal(
          (await upload({ ...s, sha256: "0".repeat(64) })).status,
          422,
        );
        const bogus = Buffer.from("not an image");
        assert.equal(
          (await upload(source("drive:bogus", bogus), bogus)).status,
          400,
        );
        const first = await upload(s);
        assert.equal(first.status, 200);
        media = first.data.media_id;
        assert.equal(first.data.duplicate, false);
        const repeat = await upload(s);
        assert.equal(repeat.data.media_id, media);
        assert.equal(repeat.data.duplicate, true);
        const alias = await upload(source("chat:same-photo", bytes, "chat"));
        assert.equal(alias.data.media_id, media);
        assert.equal(
          (await db.query("select count(*)::int n from kitchen.media")).rows[0]
            .n,
          1,
        );
        const row = (
          await db.query("select object_key from kitchen.media where id=$1", [
            media,
          ])
        ).rows[0];
        assert.deepEqual(await store.get(row.object_key), bytes);
        assert.equal(
          (await req("/media/" + media + "/content?variant=original")).status,
          401,
        );
      },
    );
    await t.test(
      "chat output creates an unapproved draft and no model calls, categories or published recipes",
      async () => {
        const r = await req("/chat-intake/drafts", "POST", {
          processor,
          item: draft,
        });
        assert.equal(r.status, 200);
        item = r.data.id;
        assert.equal(r.data.category_approved, false);
        assert.equal(
          (
            await db.query(
              "select field_sources from kitchen.import_items where id=$1",
              [item],
            )
          ).rows[0].field_sources.raw_text,
          "ai",
        );
        for (const table of ["recipes", "categories", "ai_usage"])
          assert.equal(
            (await db.query("select count(*)::int n from kitchen." + table))
              .rows[0].n,
            0,
          );
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from kitchen.jobs where type='ai'",
            )
          ).rows[0].n,
          0,
        );
        await login();
        const originals = await req("/imports", "GET", undefined, cookie);
        assert.equal(originals.data.items[0].media[0].id, media);
        assert.equal(
          (await req("/chat-intake/context")).data.model_api_required,
          false,
        );
        assert.equal((await req("/chat-intake/schema")).status, 200);
      },
    );
    await t.test(
      "replays and a second channel preserve manual corrections and reject reused source identities",
      async () => {
        const changed = structuredClone(draft.content);
        changed.ingredients[0].amount.low = "7";
        assert.equal(
          (
            await req(
              "/imports/" + item,
              "PUT",
              { revision: 1, draft: changed },
              cookie,
            )
          ).status,
          200,
        );
        const repeat = await req("/chat-intake/drafts", "POST", {
          processor,
          item: draft,
        });
        assert.equal(repeat.data.id, item);
        const alias = await req("/chat-intake/drafts", "POST", {
          processor,
          item: {
            ...draft,
            key: "draft:chat-copy",
            source_keys: ["chat:same-photo"],
          },
        });
        assert.equal(alias.data.id, item);
        assert.equal(alias.data.duplicate, true);
        assert.equal(
          (
            await db.query(
              "select draft from kitchen.import_items where id=$1",
              [item],
            )
          ).rows[0].draft.ingredients[0].amount.low,
          "7",
        );
        assert.equal(
          (
            await req("/chat-intake/drafts", "POST", {
              processor,
              item: { ...draft, recipe_index: 1 },
            })
          ).status,
          409,
        );
        const other = await sharp({
          create: { width: 60, height: 70, channels: 3, background: "red" },
        })
          .png()
          .toBuffer();
        assert.equal((await upload(source(s.key, other), other)).status, 409);
        const status = await req("/chat-intake/status", "POST", {
          provider: "chat",
          external_ids: ["chat:same-photo"],
        });
        assert.equal(status.data.sources[0].drafts[0].id, item);
      },
    );
    await t.test(
      "only the owner can approve a recipe; replay after approval does not duplicate it",
      async () => {
        const current = (
          await db.query("select * from kitchen.import_items where id=$1", [
            item,
          ])
        ).rows[0];
        assert.equal(
          (
            await req("/imports/approve", "POST", {
              confirmed: true,
              expected_new_images: 1,
              items: [],
            })
          ).status,
          401,
        );
        const approved = await req(
          "/imports/approve",
          "POST",
          {
            confirmed: true,
            expected_new_images: 1,
            items: [
              {
                id: item,
                revision: current.revision,
                content: current.draft,
                paths: [["בישול"]],
              },
            ],
          },
          cookie,
        );
        assert.equal(approved.status, 200);
        const replay = await req("/chat-intake/drafts", "POST", {
          processor,
          item: draft,
        });
        assert.equal(replay.data.status, "saved");
        assert.equal(
          (await db.query("select count(*)::int n from kitchen.recipes"))
            .rows[0].n,
          1,
        );
        assert.equal(
          ChatPackageSchema.safeParse({
            format: "my-kitchen-chat-import",
            version: 1,
            processor,
            sources: [s],
            items: [{ ...draft, source_keys: ["missing:source"] }],
          }).success,
          false,
        );
      },
    );
    await close();
    server = createApp().listen(0, "127.0.0.1");
    origin = await ready();
    const batch: any[] = [];
    await t.test(
      "50 imports survive server restart and replay without duplicated drafts",
      async () => {
        for (let n = 0; n < 50; n++) {
          const image = await sharp({
            create: {
              width: 24,
              height: 24,
              channels: 3,
              background: { r: n, g: 100, b: 70 },
            },
          })
            .png()
            .toBuffer();
          const src = source("drive:batch-" + n, image);
          assert.equal((await upload(src, image)).status, 200);
          const row = {
            ...draft,
            key: "draft:batch-" + n,
            source_keys: [src.key],
            content: { ...recipe(), title: "בדיקה סינתטית " + n },
          };
          const result = await req("/chat-intake/drafts", "POST", {
            processor,
            item: row,
          });
          assert.equal(result.status, 200);
          batch.push({ row, id: result.data.id });
        }
        await close();
        server = createApp().listen(0, "127.0.0.1");
        origin = await ready();
        for (const entry of batch) {
          const replay = await req("/chat-intake/drafts", "POST", {
            processor,
            item: entry.row,
          });
          assert.equal(replay.data.id, entry.id);
          assert.equal(replay.data.duplicate, true);
        }
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from kitchen.chat_import_records",
            )
          ).rows[0].n,
          51,
        );
        assert.equal(
          (await db.query("select count(*)::int n from kitchen.ai_usage"))
            .rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "explicit owner grouping preserves both sources and remains a draft without paid OCR",
      async () => {
        await login();
        const media = (
          await db.query(
            "select media_id from kitchen.import_media where item_id=any($1::uuid[]) order by item_id",
            [batch.slice(0, 2).map((x) => x.id)],
          )
        ).rows.map((x) => x.media_id);
        const before = (
          await db.query(
            "select count(*)::int n from kitchen.jobs where type='ai'",
          )
        ).rows[0].n;
        const result = await req(
          "/imports/group",
          "POST",
          { item_ids: batch.slice(0, 2).map((x) => x.id), media_order: media },
          cookie,
        );
        assert.equal(result.status, 200);
        assert.equal(result.data.chat_import, true);
        const combined = (
          await db.query("select * from kitchen.import_items where id=$1", [
            result.data.id,
          ])
        ).rows[0];
        assert.equal(combined.draft.yield, null);
        assert.equal(combined.draft.ingredients.length, 6);
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from kitchen.import_media where item_id=$1",
              [combined.id],
            )
          ).rows[0].n,
          2,
        );
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from kitchen.jobs where type='ai'",
            )
          ).rows[0].n,
          before,
        );
      },
    );
    await t.test(
      "full backup restores source tracking and private originals while excluding authorization grants",
      async () => {
        const directory = await mkdtemp(join(tmpdir(), "kitchen-chat-backup-"));
        const database = "kitchen_chat_restore_" + process.pid;
        const targetUrl = new URL(process.env.DATABASE_URL!);
        targetUrl.pathname = "/" + database;
        const client = await pool.connect();
        let target: pg.Client | undefined;
        try {
          await backupTo(client, store, directory);
          client.release();
          const manifest = JSON.parse(
            await readFile(join(directory, "manifest.json"), "utf8"),
          );
          assert.equal(manifest.data.chat_import_records.length, 52);
          assert.equal(manifest.data.chat_import_grants, undefined);
          await db.query('create database "' + database + '"');
          target = new pg.Client({ connectionString: targetUrl.toString() });
          await target.connect();
          await migrate(target);
          const restoredStore = new LocalStore(
            join(directory, "restored-media"),
          );
          await restoreFrom(target, restoredStore, directory);
          assert.equal(
            (
              await target.query(
                "select count(*)::int n from kitchen.chat_import_records",
              )
            ).rows[0].n,
            52,
          );
          assert.equal(
            (
              await target.query(
                "select count(*)::int n from kitchen.chat_import_grants",
              )
            ).rows[0].n,
            0,
          );
          const m = (
            await target.query(
              "select object_key from kitchen.media where id=$1",
              [media],
            )
          ).rows[0];
          assert.deepEqual(await restoredStore.get(m.object_key), bytes);
        } finally {
          await target?.end();
          await db.query('drop database if exists "' + database + '"');
          await rm(directory, { recursive: true, force: true });
        }
      },
    );
  } finally {
    await close();
    await pool.end();
  }
});
