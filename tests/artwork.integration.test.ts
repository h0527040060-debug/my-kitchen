import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { db, pool, migrate, transaction } from "../server/db.ts";
import { createOwner } from "../server/auth.ts";
import { createApp } from "../server/app.ts";
import {
  categoryPaths,
  categoryPreview,
  saveRecipe,
} from "../server/recipes.ts";
import { registerMedia, processMedia } from "../server/media.ts";
import { recipe } from "./fixture.ts";
if (
  !process.env.DATABASE_URL ||
  new URL(process.env.DATABASE_URL).pathname !== "/kitchen_test"
)
  throw Error("Artwork tests require kitchen_test");
test("owner imports generated artwork without provider calls, preserves sources and rejects stale main-image selection", async () => {
  await db.query("drop schema if exists kitchen cascade");
  await migrate();
  await createOwner(db, "owner@example.test", "test-only-password-12345");
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "owner@example.test",
      password: "test-only-password-12345",
    }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const request = async (path: string, method = "GET", body?: any) => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        cookie,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    const category = await transaction((tx) =>
      categoryPaths(tx, [["אפייה", "מאפים מלוחים", "פיצות"]]),
    );
    const saved = await transaction((tx) =>
      saveRecipe(tx, {
        content: recipe(),
        status: "published",
        category_ids: category.ids,
        confirm_categories: true,
      }),
    );
    const image = await sharp({
      create: { width: 500, height: 500, channels: 3, background: "#58714d" },
    })
      .png()
      .toBuffer();
    const source = await registerMedia(db, image, "image/png", "source");
    const personalCopy = await registerMedia(
      db,
      image,
      "image/png",
      "personal",
    );
    assert.notEqual(source.id, personalCopy.id);
    assert.notEqual(source.object_key, personalCopy.object_key);
    await processMedia(source.id);
    await db.query(
      "insert into kitchen.recipe_media(recipe_id,media_id)values($1,$2)",
      [saved.id, source.id],
    );
    const art = await sharp(image).tint("#dd8844").webp().toBuffer();
    const data = {
      generator: "chatgpt_image_tool",
      model: "not reported by tool",
      prompt_version: "synthetic-test-v1",
      atlas_sha256: "a".repeat(64),
      tile_index: 0,
      recipe_id: saved.id,
      recipe_revision: saved.revision,
      source_media_ids: [source.id],
      prompt: "Synthetic test only; no provider call",
    };
    const upload = async (provenance: any, auth = true) => {
      const f = new FormData();
      f.append(
        "file",
        new Blob([art], { type: "image/webp" }),
        "synthetic-art.webp",
      );
      f.append("provenance", JSON.stringify(provenance));
      const r = await fetch(base + "/api/media/illustrations", {
        method: "POST",
        headers: auth ? { cookie } : {},
        body: f,
      });
      return { status: r.status, body: await r.json() };
    };
    assert.equal((await upload(data, false)).status, 401);
    assert.equal((await upload({ ...data, recipe_revision: 999 })).status, 409);
    const uploaded = await upload(data);
    assert.equal(uploaded.status, 200);
    assert.equal(uploaded.body.origin, "ai");
    assert.equal(uploaded.body.metadata.provider_api_call, false);
    const replay = await upload(data);
    assert.equal(replay.body.id, uploaded.body.id);
    assert.equal(replay.body.duplicate, true);
    await processMedia(uploaded.body.id);
    assert.equal(
      (await request("/media/" + uploaded.body.id)).body.state,
      "ready",
    );
    const attached = await request("/recipes/" + saved.id + "/media", "POST", {
      media_id: uploaded.body.id,
      primary: true,
      position: 0,
      expected_revision: saved.revision,
      expected_primary_media_id: null,
    });
    assert.equal(attached.status, 200);
    assert.equal(
      (
        await request("/recipes/" + saved.id + "/media", "POST", {
          media_id: source.id,
          primary: true,
          position: 1,
          expected_revision: saved.revision,
          expected_primary_media_id: null,
        })
      ).status,
      409,
    );
    const read = await request("/recipes/" + saved.id);
    assert.equal(read.body.recipe.primary_media_id, uploaded.body.id);
    assert(read.body.media.some((m: any) => m.id === source.id));
    assert.equal(read.body.recipe.content.title, saved.content.title);
    const redirects = [
      { from: ["אפייה", "פיצה"], to_category_id: category.ids[0] },
    ];
    assert.equal(
      (await request("/categories/path-redirects", "PUT", { redirects }))
        .status,
      200,
    );
    const preview = await categoryPreview(db, [["אפייה", "פיצה"]]);
    assert.equal(preview.new_images, 0);
    const old = await transaction((tx) =>
      categoryPaths(tx, [["אפייה", "פיצה"]]),
    );
    assert.deepEqual(old.ids, category.ids);
    assert.equal(old.created_images, 0);
    assert.equal(
      (await db.query("select count(*)::int n from kitchen.ai_usage")).rows[0]
        .n,
      0,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
  }
});
