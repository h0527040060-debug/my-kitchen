import { test, expect } from "@playwright/test";
import sharp from "sharp";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { recipe } from "../tests/fixture.ts";
let worker: ChildProcess;
let recipeId = "";
const title = "בדיקת נייד סינתטית — לחם הבית עם כותרת עברית ארוכה במיוחד";
test.beforeAll(() => {
  worker = spawn(
    process.execPath,
    ["--experimental-strip-types", "server/worker.ts"],
    {
      env: {
        ...process.env,
        OPENAI_API_KEY: "",
        AI_DAILY_MAX_CALLS: "0",
        DATABASE_URL:
          process.env.DATABASE_URL ||
          "postgresql://kitchen:kitchen-local-dev@localhost:5432/kitchen_test",
      },
      stdio: "ignore",
    },
  );
});
test.afterAll(() => worker?.kill("SIGTERM"));
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("אימייל", { exact: true }).fill("owner@example.test");
  await page
    .getByLabel("סיסמה", { exact: true })
    .fill("test-only-password-12345");
  await page
    .getByRole("button", { name: "כניסה למטבח שלי", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "מתכון חדש", exact: true }),
  ).toBeVisible();
});
test("mobile owner creates a real server recipe and preserves a cooking checklist across reloads", async ({
  page,
}) => {
  await page.getByRole("button", { name: "מתכון חדש", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "מתכון חדש" });
  await editor.getByLabel("שם המתכון", { exact: true }).fill(title);
  await editor.getByLabel("כמות בסיס", { exact: true }).fill("5");
  await editor.getByLabel("יחידת תפוקה", { exact: true }).fill("מנות");
  await editor.getByRole("tab", { name: /מצרכים/ }).click();
  await editor.getByRole("button", { name: "מצרך", exact: true }).click();
  await editor.getByLabel("שם", { exact: true }).fill("קמח");
  await editor.getByRole("textbox", { name: "כמות", exact: true }).fill("2");
  await editor.getByLabel("יחידה", { exact: true }).fill("ק״ג");
  await editor.getByRole("tab", { name: /הכנה/ }).click();
  await editor.getByRole("button", { name: "שלב", exact: true }).click();
  await editor
    .getByLabel("הוראות", { exact: true })
    .fill(
      "ללוש בצק. לאפות 30 דקות ב־180 מעלות. זו שורת טקסט ארוכה כדי לבחון גלישת עברית במסך צר ולוודא שכל המידע נשאר קריא.",
    );
  await editor
    .locator(".k-editor-extra")
    .filter({ hasText: /^קטגוריות/ })
    .locator("summary")
    .click();
  await editor.getByRole("checkbox", { name: "בישול", exact: true }).check();
  await page.setViewportSize({ width: 390, height: 480 });
  await editor.getByRole("tab", { name: "עוד", exact: true }).click();
  await editor.getByLabel("הערות וטיפים", { exact: true }).focus();
  await editor
    .getByRole("button", { name: "אישור ושמירת מתכון", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/recipes\/[a-f0-9-]+$/);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  recipeId = page.url().split("/recipes/")[1];
  expect(recipeId).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("כמה מכינים?", { exact: true }).fill("8");
  await expect(page.getByText("3.2", { exact: true })).toBeVisible();
  await expect(page.getByText(/180 מעלות/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "מתחילים לבשל", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "קודם מכינים את הכול" }),
  ).toBeVisible();
  const ingredient = page.getByRole("checkbox", { name: /3.2.*קמח/ });
  await ingredient.click();
  await expect(ingredient).toBeChecked();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /3.2.*קמח/ })).toBeChecked();
  await page.screenshot({
    path: "test-results/mobile-cooking.png",
    fullPage: true,
  });
});
test("private source gallery, server thumbnails, image zoom and mobile navigation work", async ({
  page,
}) => {
  test.skip(!recipeId, "requires creation test");
  const bytes = await sharp({
    create: {
      width: 1200,
      height: 1800,
      channels: 3,
      background: "#" + randomBytes(3).toString("hex"),
    },
  })
    .png()
    .toBuffer();
  const mediaResponse = await page.request.post("/api/media", {
    multipart: {
      file: {
        name: "synthetic-source.png",
        mimeType: "image/png",
        buffer: bytes,
      },
    },
  });
  expect(mediaResponse.ok()).toBe(true);
  const m = await mediaResponse.json();
  expect(
    (
      await page.request.post(`/api/recipes/${recipeId}/media`, {
        data: { media_id: m.id, primary: false, position: 0 },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/#/recipes/" + recipeId);
  await page.getByRole("button", { name: /פתיחת כל הגלריה/ }).click();
  await expect(page.getByRole("dialog", { name: "הגלריה שלי" })).toBeVisible();
  const zoom = page.getByRole("slider");
  await zoom.fill("200");
  expect(
    await page
      .locator(".k-zoom img")
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth === 1200,
      ),
  ).toBe(true);
  await page.getByRole("button", { name: "סגירה", exact: true }).click();
  await page.getByRole("button", { name: "קניות", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "בדרך לקניות" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "עוד", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "מידות והעדפות", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-settings.png",
    fullPage: true,
  });
});
test("AI main image and original are paired above the fold, gallery pages and compact editor retains detail fields", async ({
  page,
}) => {
  test.skip(!recipeId, "requires creation test");
  const current = await (
    await page.request.get(`/api/recipes/${recipeId}`)
  ).json();
  const source = current.media[0];
  const databaseUrl = process.env.DATABASE_URL!;
  expect(new URL(databaseUrl).pathname).toBe("/kitchen_test");
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false });
  try {
    await pool.query("update kitchen.media set origin='source' where id=$1", [
      source.id,
    ]);
  } finally {
    await pool.end();
  }
  const art = await sharp({
    create: {
      width: 600,
      height: 600,
      channels: 3,
      background: "#" + randomBytes(3).toString("hex"),
    },
  })
    .webp()
    .toBuffer();
  const upload = await page.request.post("/api/media/illustrations", {
    multipart: {
      file: { name: "synthetic-ai.webp", mimeType: "image/webp", buffer: art },
      provenance: JSON.stringify({
        generator: "chatgpt_image_tool",
        model: "synthetic test",
        prompt_version: "synthetic-v1",
        atlas_sha256: "b".repeat(64),
        tile_index: 0,
        recipe_id: recipeId,
        recipe_revision: current.recipe.revision,
        source_media_ids: [source.id],
        prompt: "Synthetic test only",
      }),
    },
  });
  expect(upload.ok()).toBe(true);
  const generated = await upload.json();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/media/${generated.id}`)).json())
          .state,
      { timeout: 30000 },
    )
    .toBe("ready");
  expect(
    (
      await page.request.post(`/api/recipes/${recipeId}/media`, {
        data: {
          media_id: generated.id,
          primary: true,
          position: 1,
          expected_revision: current.recipe.revision,
          expected_primary_media_id: null,
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(`/#/recipes/${recipeId}`);
  const pair = page.getByRole("region", { name: "תמונת המנה והמקור" });
  await expect(
    pair.getByRole("button", { name: "פתיחת המקור", exact: true }),
  ).toBeVisible();
  const ai = pair.getByRole("button", {
    name: "פתיחת תמונת המחשה באמצעות AI",
    exact: true,
  });
  const b = await ai.boundingBox();
  expect(b!.y + b!.height).toBeLessThan(844);
  const boxes = await pair.locator(".k-recipe-media-card").evaluateAll((els) =>
    els.map((e) => ({
      y: e.getBoundingClientRect().y,
      w: e.getBoundingClientRect().width,
    })),
  );
  expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1);
  expect(boxes[0].w).toBeLessThan(195);
  await page.screenshot({
    path: "test-results/mobile-paired-gallery.png",
    fullPage: true,
  });
  await ai.click();
  await expect(page.locator(".k-zoom img")).toHaveAttribute(
    "src",
    new RegExp(generated.id),
  );
  await page.getByRole("button", { name: "התמונה הבאה", exact: true }).click();
  await expect(page.locator(".k-zoom img")).toHaveAttribute(
    "src",
    new RegExp(source.id),
  );
  const cdp = await page.context().newCDPSession(page);
  const imageBox = await page.locator(".k-zoom").boundingBox();
  const swipeY = Math.min(imageBox!.y + 60, 650);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 250, y: swipeY }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 70, y: swipeY }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  await expect(page.locator(".k-zoom img")).toHaveAttribute(
    "src",
    new RegExp(generated.id),
  );
  await page.getByRole("button", { name: "סגירה", exact: true }).click();
  await page.getByRole("button", { name: "עריכה", exact: true }).click();
  const editor = page.getByRole("dialog", { name: /עריכת/ });
  await editor.getByRole("tab", { name: /מצרכים/ }).click();
  await editor.locator(".k-ingredient-details summary").first().click();
  await editor
    .getByLabel("הערת הכנה", { exact: true })
    .first()
    .fill("מנופה — בדיקת שמירת שדה מקופל");
  await editor.locator(".k-ingredient-details summary").first().click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 480 });
    expect(
      await editor.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
  }
  await page.screenshot({
    path: "test-results/mobile-compact-editor.png",
    fullPage: true,
  });
  await editor.getByRole("tab", { name: "פרטים", exact: true }).click();
  await editor
    .getByRole("button", { name: "אישור ושמירת מתכון", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  const saved = await (
    await page.request.get(`/api/recipes/${recipeId}`)
  ).json();
  expect(saved.recipe.content.ingredients[0].note).toBe(
    "מנופה — בדיקת שמירת שדה מקופל",
  );
  expect(
    saved.media.some((m: any) => m.id === source.id && m.origin === "source"),
  ).toBe(true);
});
test("unverified browser cannot access media or charge AI", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
  });
  const page = await context.newPage();
  expect((await context.request.get("/api/recipes")).status()).toBe(401);
  expect(
    (
      await context.request.post("/api/ai/search", {
        data: { query: "עוגה" },
        headers: { "Idempotency-Key": "anonymous-test" },
      })
    ).status(),
  ).toBe(401);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /ברוכים הבאים/ }),
  ).toBeVisible();
  await context.close();
});
test("a real concurrent edit stays visible in the mobile editor and cannot overwrite the newer revision", async ({
  page,
}) => {
  const original = recipe();
  original.title = "בדיקת התנגשות סינתטית";
  const created = await (
    await page.request.post("/api/recipes", {
      data: {
        content: original,
        status: "published",
        category_ids: [],
        confirm_categories: true,
      },
    })
  ).json();
  await page.goto("/#/recipes/" + created.id);
  await page.getByRole("button", { name: "עריכה", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "עריכת מתכון" });
  await expect(dialog).toBeVisible();
  const newer = await page.request.put("/api/recipes/" + created.id, {
    data: {
      content: { ...original, notes: "תיקון ממכשיר שני" },
      revision: created.revision,
      status: "published",
      category_ids: [],
      confirm_categories: true,
    },
  });
  expect(newer.ok()).toBe(true);
  await dialog
    .getByRole("button", { name: "אישור ושמירת מתכון", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "המתכון השתנה במכשיר אחר",
  );
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
