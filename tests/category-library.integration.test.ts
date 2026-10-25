import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { db, pool, migrate, transaction } from "../server/db.ts";
import { createOwner } from "../server/auth.ts";
import { createApp } from "../server/app.ts";
import { categoryPaths, saveRecipe } from "../server/recipes.ts";
import { registerMedia, processMedia } from "../server/media.ts";
import { handleJob } from "../server/worker.ts";
import { runOne } from "../server/jobs.ts";
import { recipe } from "./fixture.ts";
import { categoryPath } from "../shared/category-themes.ts";
if (
  !process.env.DATABASE_URL ||
  new URL(process.env.DATABASE_URL).pathname !== "/kitchen_test"
)
  throw Error("Category tests use only kitchen_test");
test("approved tree, free image library and legacy source thumbnails survive real API/worker operations", async () => {
  await db.query("drop schema if exists kitchen cascade");
  await migrate();
  await createOwner(db, "owner@example.test", "test-only-password-12345");
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  let cookie = "";
  async function req(path: string, method = "GET", body?: any, auth = true) {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        ...(auth ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      body: await r.json().catch(() => ({})),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  try {
    cookie = (
      await req(
        "/login",
        "POST",
        { email: "owner@example.test", password: "test-only-password-12345" },
        false,
      )
    ).cookie!;
    const old = await transaction((tx) =>
      categoryPaths(tx, [["סלטים", "סלטי כרוב"]]),
    );
    const saved = await transaction((tx) =>
      saveRecipe(tx, {
        content: recipe(),
        status: "published",
        category_ids: old.ids,
        confirm_categories: true,
      }),
    );
    assert.equal(
      (await req("/categories/starter", "POST", { confirmed: true }, false))
        .status,
      401,
    );
    assert.equal((await req("/categories/starter", "POST", {})).status, 400);
    assert.equal(
      (await req("/categories/starter", "POST", { confirmed: true })).status,
      200,
    );
    const first = (await req("/categories")).body.items;
    assert.deepEqual(
      first
        .filter((c: any) => !c.parent_id)
        .map((c: any) => c.name)
        .sort(),
      ["אפייה", "בישול", "קינוחים"].sort(),
    );
    assert.deepEqual(categoryPath(first, old.ids[0]), [
      "בישול",
      "סלטים",
      "סלטי כרוב",
    ]);
    for (const name of [
      "בשר",
      "עוף",
      "דגים",
      "עוגות",
      "עוגיות",
      "עוגות גבינה אפויות",
      "עוגות גבינה ללא אפייה",
    ])
      assert(first.some((c: any) => c.name === name));
    assert.equal(first.find((c: any) => c.name === "בישול").recipe_count, 1);
    await req("/categories/starter", "POST", { confirmed: true });
    assert.equal((await req("/categories")).body.items.length, first.length);
    // Even an accidentally configured provider key cannot enable paid operations.
    process.env.OPENAI_API_KEY = "test-key-never-sent";
    process.env.AI_DAILY_MAX_CALLS = "100";
    for (let n = 0; n < 150; n++) {
      if (!(await runOne(handleJob))) break;
    }
    const categories = (await req("/categories")).body.items;
    assert(
      categories.every((c: any) => c.media_id && c.image_state === "ready"),
    );
    assert.equal(
      (await db.query("select count(*)::int n from kitchen.ai_usage")).rows[0]
        .n,
      0,
    );
    const image = categories.find((c: any) => c.name === "דגים").media_id;
    const visible = await fetch(base + "/api/media/" + image + "/content");
    assert.equal(visible.status, 401);
    const content = await fetch(base + "/api/media/" + image + "/content", {
      headers: { cookie },
    });
    assert.equal(content.status, 200);
    assert.equal(
      (await sharp(Buffer.from(await content.arrayBuffer())).metadata()).width,
      400,
    );
    const before = (
      await db.query("select count(*)::int n from kitchen.category_images")
    ).rows[0].n;
    await req("/categories/starter", "POST", { confirmed: true });
    assert.equal(await runOne(handleJob), false);
    assert.equal(
      (await db.query("select count(*)::int n from kitchen.category_images"))
        .rows[0].n,
      before,
    );
    const source = await registerMedia(
      db,
      await sharp({
        create: { width: 720, height: 960, channels: 3, background: "#d8b8a2" },
      })
        .png()
        .toBuffer(),
      "image/png",
      "source",
    );
    await processMedia(source.id);
    await db.query(
      "insert into kitchen.recipe_media(recipe_id,media_id,position) values($1,$2,0)",
      [saved.id, source.id],
    );
    assert.equal(
      (
        await db.query(
          "select primary_media_id from kitchen.recipes where id=$1",
          [saved.id],
        )
      ).rows[0].primary_media_id,
      null,
    );
    assert.equal(
      (await req("/recipes/" + saved.id)).body.recipe.primary_media_id,
      source.id,
    );
    assert.equal(
      (await req("/recipes")).body.items.find((r: any) => r.id === saved.id)
        .primary_media_id,
      source.id,
    );
    for (const path of [
      "/assistant",
      "/ai/search",
      "/ai/check",
      "/voice/speak",
      "/voice/transcribe",
      `/recipes/${saved.id}/image`,
      `/recipes/${saved.id}/rescan`,
      `/imports/${saved.id}/rescan`,
      `/meals/${saved.id}/suggest`,
    ])
      assert.equal((await req(path, "POST", {})).status, 404, path);
  } finally {
    process.env.OPENAI_API_KEY = "";
    process.env.AI_DAILY_MAX_CALLS = "0";
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
  }
});
