import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, pool, migrate } from "../server/db.ts";
import { createOwner, digest } from "../server/auth.ts";
import { createApp } from "../server/app.ts";
import { handleJob } from "../server/worker.ts";
import { runOne, enqueue } from "../server/jobs.ts";
import { registerMedia } from "../server/media.ts";
import { emptyRecipe } from "../shared/model.ts";
import { ingredient, recipe } from "./fixture.ts";

if (
  !process.env.DATABASE_URL ||
  new URL(process.env.DATABASE_URL).pathname !== "/kitchen_test"
)
  throw Error(
    "Collection tests reset only the dedicated local kitchen_test database",
  );
process.env.OPENAI_API_KEY = "";
process.env.AI_DAILY_MAX_CALLS = "0";

test("optional recipe content, whole collections, reversible trash and single-owner recovery", async (t) => {
  await db.query("drop schema if exists kitchen cascade");
  await migrate();
  const email = "owner@example.test",
    password = "test-only-password-12345";
  await createOwner(db, email, password);
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + (server.address() as any).port;
  let cookie = "";
  async function request(
    path: string,
    method = "GET",
    body?: any,
    auth = cookie,
  ) {
    const response = await fetch(origin + "/api" + path, {
      method,
      headers: {
        ...(auth ? { cookie: auth } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function login(e = email, p = password) {
    const r = await request("/login", "POST", { email: e, password: p }, "");
    assert.equal(r.status, 200);
    cookie = r.cookie!;
  }
  const bytes = await sharp({
    create: { width: 40, height: 60, channels: 3, background: "#849879" },
  })
    .png()
    .toBuffer();
  let media: any,
    saved: any,
    selection: any[] = [];
  try {
    await login();
    await t.test(
      "content omissions are retained, with warnings, without fabricated yield or categories",
      async () => {
        const content = {
          ...recipe(),
          title: "",
          yield: null,
          active_minutes: null,
          total_minutes: null,
        };
        content.ingredients.push(
          ingredient("מלח", "לפי הטעם"),
          ingredient("תבלין", ""),
        );
        const r = await request("/recipes", "POST", {
          content,
          status: "published",
          category_ids: [],
          confirm_categories: false,
        });
        assert.equal(r.status, 200, JSON.stringify(r.data));
        saved = r.data;
        assert.equal(saved.content.yield, null);
        assert.equal(saved.content.title, "");
        assert.equal(saved.active_minutes, null);
        assert.deepEqual(saved.category_ids, []);
        assert.ok(saved.warnings.length);
        assert.equal(saved.content.ingredients.at(-1).amount.kind, "missing");
        assert.equal(
          (await request("/account", "GET", undefined, "")).status,
          401,
        );
        assert.equal(
          (await request("/imports/selection", "GET", undefined, "")).status,
          401,
        );
      },
    );
    await t.test(
      "source quantities support cooking and shopping without a base yield; explicit scaling is blocked",
      async () => {
        const start = await request("/cooking", "POST", {
          recipe_id: saved.id,
        });
        assert.equal(start.status, 200);
        const current = (await request("/cooking/" + start.data.id)).data
          .cooking;
        assert.equal(current.target, "");
        assert.equal(current.snapshot.yield, null);
        assert.equal(current.snapshot.ingredients[0].amount.low, "2");
        assert.equal(
          (
            await request("/cooking", "POST", {
              recipe_id: saved.id,
              target: "8",
            })
          ).status,
          422,
        );
        const change = await request("/cooking/" + current.id, "PATCH", {
          revision: current.revision,
          checked_ingredients: [current.snapshot.ingredients[0].id],
          checked_steps: [],
          step_index: 0,
        });
        assert.equal(change.status, 200);
        assert.equal(
          (await request("/cooking/" + current.id)).data.cooking
            .checked_ingredients.length,
          1,
        );
        const { shoppingForRecipes } = await import("../shared/planning.ts");
        const lines = shoppingForRecipes([
          { recipe_id: saved.id, content: saved.content, target: "" },
        ]);
        assert.ok(lines.some((l) => l.name === "קמח"));
        assert.equal(
          (await request("/recipes/" + saved.id)).data.recipe.content.yield,
          null,
        );
      },
    );
    await t.test(
      "select all crosses 50-item pages; lightweight preview accepts missing fields and source-only entries",
      async () => {
        media = await registerMedia(db, bytes, "image/png", "source", {});
        for (let n = 0; n < 55; n++) {
          const id = randomUUID();
          const content =
            n === 54
              ? null
              : {
                  ...emptyRecipe(),
                  title: "אוסף בדיקה סינתטי " + n,
                  ingredients: [ingredient("מלח", "לפי הטעם")],
                };
          await db.query(
            "insert into kitchen.import_items(id,status,draft,suggestions) values($1,'needs_review',$2,$3)",
            [
              id,
              content ? JSON.stringify(content) : null,
              JSON.stringify({ paths: n % 2 ? [["אוסף", "סלטים"]] : [] }),
            ],
          );
          await db.query(
            "insert into kitchen.import_media(item_id,media_id,position) values($1,$2,0)",
            [id, media.id],
          );
        }
        const page = (await request("/imports?view=pending")).data;
        assert.equal(page.items.length, 50);
        assert.equal(page.total, 55);
        selection = (await request("/imports/selection?view=pending")).data
          .items;
        assert.equal(selection.length, 55);
        assert.equal(selection[0].draft, undefined);
        const preview = await request("/imports/preview-batch", "POST", {
          selection,
        });
        assert.equal(preview.status, 200);
        assert.equal(preview.data.items.length, 55);
        assert.equal(preview.data.new_images, 2);
        assert.equal(
          preview.data.items.filter((r: any) => r.source_only).length,
          1,
        );
        assert.equal(preview.data.items[0].content, undefined);
        assert.equal(
          (
            await request("/imports/approve-batch", "POST", {
              selection,
              expected_new_images: 2,
            })
          ).status,
          400,
        );
        await db.query(
          "update kitchen.import_items set revision=revision+1 where id=$1",
          [selection[0].id],
        );
        assert.equal(
          (await request("/imports/preview-batch", "POST", { selection }))
            .status,
          409,
        );
        selection = (await request("/imports/selection?view=pending")).data
          .items;
      },
    );
    await t.test(
      "batch saving is resumable and deduplicates branches and image jobs",
      async () => {
        const before = (
          await db.query("select count(*)::int n from kitchen.recipes")
        ).rows[0].n;
        for (let at = 0; at < selection.length; at += 50) {
          const body = { selection: selection.slice(at, at + 50) };
          const preview = (
            await request("/imports/preview-batch", "POST", body)
          ).data;
          const r = await request("/imports/approve-batch", "POST", {
            ...body,
            confirmed: true,
            expected_new_images: preview.new_images,
          });
          assert.equal(r.status, 200, JSON.stringify(r.data));
          assert.equal(r.data.saved, body.selection.length);
          const replay = await request("/imports/approve-batch", "POST", {
            ...body,
            confirmed: true,
            expected_new_images: 0,
          });
          assert.equal(replay.status, 200);
          assert.equal(replay.data.saved, 0);
        }
        assert.equal(
          (await db.query("select count(*)::int n from kitchen.recipes"))
            .rows[0].n,
          before + 55,
        );
        assert.equal(
          (await db.query("select count(*)::int n from kitchen.categories"))
            .rows[0].n,
          2,
        );
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from kitchen.jobs where operation='categoryImage'",
            )
          ).rows[0].n,
          2,
        );
        assert.equal(
          (await db.query("select count(*)::int n from kitchen.ai_usage"))
            .rows[0].n,
          0,
        );
        assert.equal((await request("/imports?view=pending")).data.total, 0);
        const all = (await request("/recipes?selection=true")).data.items;
        assert.equal(all.length, 56);
        assert.equal(all[0].content, undefined);
      },
    );
    await t.test(
      "trash and restore preserve original media, recipe status, and cross-page selection",
      async () => {
        selection = (await request("/imports/selection?view=saved")).data.items;
        const bad = selection.map((r, i) =>
          i ? r : { ...r, recipe_revision: r.recipe_revision + 1 },
        );
        assert.equal(
          (
            await request("/imports/trash", "POST", {
              confirmed: true,
              selection: bad,
            })
          ).status,
          409,
        );
        assert.equal((await request("/imports?view=trash")).data.total, 0);
        assert.equal(
          (
            await request("/imports/trash", "POST", {
              confirmed: true,
              selection,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request("/imports/trash", "POST", {
              confirmed: true,
              selection,
            })
          ).status,
          200,
        );
        assert.equal((await request("/imports?view=trash")).data.total, 55);
        assert.equal((await request("/recipes")).data.total, 1);
        const original = await fetch(
          origin + "/api/media/" + media.id + "/content?variant=original",
          { headers: { cookie } },
        );
        assert.equal(original.status, 200);
        assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
        selection = (await request("/imports/selection?view=trash")).data.items;
        assert.equal(
          (
            await request("/imports/restore", "POST", {
              confirmed: true,
              selection,
            })
          ).status,
          200,
        );
        assert.equal((await request("/recipes")).data.total, 56);
        assert.equal((await request("/imports?view=saved")).data.total, 55);
        assert.equal((await request("/imports?view=saved")).data.total, 55);
        const book = (await request("/recipes?selection=true")).data.items;
        assert.equal(
          (
            await request("/recipe-collection/trash", "POST", {
              confirmed: true,
              selection: book,
            })
          ).status,
          200,
        );
        assert.equal((await request("/recipes")).data.total, 0);
        const trashed = (await request("/recipes?status=trash&selection=true"))
          .data.items;
        assert.equal(trashed.length, 56);
        assert.equal(
          (
            await request("/recipe-collection/restore", "POST", {
              confirmed: true,
              selection: trashed,
            })
          ).status,
          200,
        );
        assert.equal((await request("/recipes")).data.total, 56);
      },
    );
    await t.test(
      "late extraction failure cannot resurrect a deleted import",
      async () => {
        // The provider below is a deterministic test double, never a live OCR call.
        await db.query(
          "update kitchen.jobs set status='cancelled' where status='queued'",
        );
        const id = randomUUID();
        await db.query("insert into kitchen.import_items(id) values($1)", [id]);
        await db.query(
          "insert into kitchen.import_media(item_id,media_id,position) values($1,$2,0)",
          [id, media.id],
        );
        await enqueue(db, "ai", "extractRecipe", "late-test", {
          item_id: id,
          revision: 1,
          generation: 1,
        });
        await runOne(async (job) => {
          const selected = [{ id, revision: 1 }];
          assert.equal(
            (
              await request("/imports/trash", "POST", {
                confirmed: true,
                selection: selected,
              })
            ).status,
            200,
          );
          assert.deepEqual(
            await handleJob(job, () => ({
              extractRecipe: () =>
                assert.fail("deleted jobs must not invoke OCR"),
            })),
            { skipped: true },
          );
          throw Error("simulated response lost after deletion");
        });
        assert.equal(
          (
            await db.query(
              "select status from kitchen.import_items where id=$1",
              [id],
            )
          ).rows[0].status,
          "trash",
        );
      },
    );
    await t.test(
      "account changes verify the old password, revoke sessions and intake grants, and never expose hashes",
      async () => {
        const old = cookie;
        assert.equal(
          (
            await request("/account", "PUT", {
              email,
              new_password: "new-password-12345",
              current_password: "wrong",
            })
          ).status,
          403,
        );
        assert.equal((await request("/session")).status, 200);
        await db.query(
          "insert into kitchen.chat_import_grants(token_hash,expires_at) values($1,now()+interval '10 minutes')",
          [digest("testgrant")],
        );
        const updated = await request("/account", "PUT", {
          email: "changed@example.test",
          new_password: "new-password-12345",
          current_password: password,
        });
        assert.equal(updated.status, 200);
        cookie = updated.cookie!;
        assert.equal(
          (await request("/session", "GET", undefined, old)).status,
          401,
        );
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from kitchen.chat_import_grants where not revoked",
            )
          ).rows[0].n,
          0,
        );
        const generated = await request("/account/recovery-codes", "POST", {
          current_password: "new-password-12345",
        });
        assert.equal(generated.status, 200);
        assert.equal(generated.data.codes.length, 8);
        const info = (await request("/account")).data;
        assert.equal(info.recovery_codes_remaining, 8);
        assert.equal(info.password_hash, undefined);
        assert.equal(info.recovery_hashes, undefined);
        const hashes = (
          await db.query("select recovery_hashes from kitchen.owner")
        ).rows[0].recovery_hashes;
        assert.equal(hashes.includes(generated.data.codes[0]), false);
        const oldSession = cookie,
          code = generated.data.codes[0];
        assert.equal(
          (
            await request(
              "/account/recover",
              "POST",
              { email: "changed@example.test", code: "0".repeat(64), password },
              "",
            )
          ).status,
          401,
        );
        const recovered = await request(
          "/account/recover",
          "POST",
          { email: "changed@example.test", code, password },
          "",
        );
        assert.equal(recovered.status, 200);
        cookie = recovered.cookie!;
        assert.equal(
          (await request("/session", "GET", undefined, oldSession)).status,
          401,
        );
        assert.equal(
          (
            await request(
              "/account/recover",
              "POST",
              { email: "changed@example.test", code, password },
              "",
            )
          ).status,
          401,
        );
        assert.equal(
          (await request("/account")).data.recovery_codes_remaining,
          7,
        );
        const restored = await request("/account", "PUT", {
          email,
          current_password: password,
        });
        assert.equal(restored.status, 200);
        cookie = restored.cookie!;
        assert.equal((await request("/recipes")).data.total, 56);
      },
    );
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    await pool.end();
  }
});
