import { test, expect } from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { emptyRecipe } from "../shared/model.ts";

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
test("mobile bulk save accepts missing fields across pages, selects every matching recipe and restores trash", async ({
  page,
}) => {
  test.setTimeout(90000);
  const url =
    process.env.DATABASE_URL ||
    "postgresql://kitchen:kitchen-local-dev@localhost:5432/kitchen_test";
  if (new URL(url).pathname !== "/kitchen_test")
    throw Error("fixtures require kitchen_test");
  const image = await sharp({
    create: { width: 80, height: 100, channels: 3, background: "#e0bc9c" },
  })
    .png()
    .toBuffer();
  const uploaded = await page.request.post("/api/media", {
    multipart: {
      file: {
        name: "synthetic-collection-source.png",
        mimeType: "image/png",
        buffer: image,
      },
    },
  });
  expect(uploaded.ok()).toBe(true);
  const media = await uploaded.json();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const prefix = "אוסף נייד סינתטי " + Date.now();
  try {
    for (let n = 0; n < 55; n++) {
      const id = randomUUID();
      await client.query(
        "insert into kitchen.import_items(id,status,draft,suggestions) values($1,'needs_review',$2,'{\"paths\":[]}')",
        [id, JSON.stringify({ ...emptyRecipe(), title: prefix + " " + n })],
      );
      await client.query(
        "insert into kitchen.import_media(item_id,media_id,position) values($1,$2,0)",
        [id, media.id],
      );
    }
  } finally {
    await client.end();
  }
  const pending = (
    await (await page.request.get("/api/imports?view=pending")).json()
  ).total;
  expect(pending).toBeGreaterThanOrEqual(55);
  await page.goto("/#/imports");
  await page
    .getByRole("button", { name: "בחירת הכול — כל העמודים", exact: true })
    .click();
  await expect(
    page.getByText(`נבחרו ${pending} פריטים`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: `בדיקת סיווג ואישור אצווה (${pending})`,
      exact: true,
    })
    .click();
  const preview = page.getByRole("dialog", { name: "אישור סיווג האצווה" });
  await expect(
    preview.getByText(/פרטים חסרים אינם מעכבים שמירה/),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "אישור ההצעות ושמירת המתכונים", exact: true })
    .click();
  await expect(preview).not.toBeVisible({ timeout: 30000 });
  await page.goto("/#/recipes");
  await page
    .getByRole("textbox", { name: "חיפוש מתכונים", exact: true })
    .fill(prefix);
  await page.getByRole("button", { name: "חיפוש", exact: true }).click();
  await expect(
    page.getByText("55 מתכונים באוסף", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "בחירה ופעולות", exact: true })
    .click();
  await page
    .getByRole("button", { name: "בחירת הכול — כל העמודים", exact: true })
    .click();
  await expect(
    page.getByText("נבחרו 55 מתכונים", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "מחיקת הנבחרים", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "אישור פעולה" })
    .getByRole("button", { name: "אישור", exact: true })
    .click();
  await expect(
    page.getByText("0 מתכונים באוסף", { exact: true }),
  ).toBeVisible();
  await page.getByText("סינון ומיון", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "אוסף", exact: true })
    .selectOption("trash");
  await expect(
    page.getByText("55 מתכונים באוסף", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "בחירת הכול — כל העמודים", exact: true })
    .click();
  await page
    .getByRole("button", { name: "שחזור הנבחרים", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "אישור פעולה" })
    .getByRole("button", { name: "אישור", exact: true })
    .click();
  await expect(
    page.getByText("0 מתכונים באוסף", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "אוסף", exact: true })
    .selectOption("published");
  await expect(
    page.getByText("55 מתכונים באוסף", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-collection.png",
    fullPage: true,
  });
});

test("single-owner account settings and recovery are reachable on a narrow screen", async ({
  page,
}) => {
  await page.getByRole("button", { name: "עוד", exact: true }).click();
  await page.getByRole("button", { name: "ניהול החשבון", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "ניהול החשבון האישי" });
  await expect(
    dialog.getByLabel("אימייל להתחברות", { exact: true }),
  ).toHaveValue("owner@example.test");
  await dialog
    .getByLabel("סיסמה נוכחית", { exact: true })
    .fill("test-only-password-12345");
  await dialog
    .getByLabel("סיסמה חדשה — רק אם רוצים לשנות", { exact: true })
    .fill("synthetic-new-password");
  await dialog
    .getByLabel("אימות סיסמה חדשה", { exact: true })
    .fill("different-password");
  await dialog
    .getByRole("button", { name: "שמירת פרטי החשבון", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "הסיסמאות החדשות אינן תואמות",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-account.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "סגירה", exact: true }).click();
  await page
    .getByRole("button", { name: "יציאה מהחשבון", exact: true })
    .click();
  await page.getByRole("button", { name: "שכחתי סיסמה", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "איפוס סיסמה עם קוד שחזור" }),
  ).toBeVisible();
  expect((await page.request.get("/api/account")).status()).toBe(401);
});
