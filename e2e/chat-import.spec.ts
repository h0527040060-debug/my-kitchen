import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { recipe } from "../tests/fixture.ts";

test("mobile owner imports a structured chat package with private source and can replay it", async ({
  page,
}) => {
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
  const before = await (await page.request.get("/api/recipes")).json();
  const image = await sharp({
    create: {
      width: 90,
      height: 70,
      channels: 3,
      background: "#" + randomUUID().replaceAll("-", "").slice(0, 6),
    },
  })
    .png()
    .toBuffer();
  const key = "file:" + randomUUID();
  const content = { ...recipe(), title: "בדיקת ייבוא צ׳אט סינתטית בנייד" };
  const bundle = {
    format: "my-kitchen-chat-import",
    version: 1,
    processor: {
      kind: "chat_session",
      name: "Synthetic browser fixture",
      model: "no model API",
      prompt_version: "chat-import-he-v1",
    },
    sources: [
      {
        key,
        provider: "file",
        external_id: key,
        filename: "synthetic-chat-source.png",
        sha256: createHash("sha256").update(image).digest("hex"),
      },
    ],
    items: [
      {
        key: "draft:" + randomUUID(),
        recipe_index: 0,
        source_keys: [key],
        content,
        suggestions: { paths: [["בישול"]], reason: "הצעה שטרם אושרה" },
      },
    ],
  };
  await page.goto("/#/imports");
  await expect(
    page.getByRole("heading", { name: "מתכונים מהצ׳אט ומ־Drive" }),
  ).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt++) {
    await page
      .getByRole("button", { name: "ייבוא חבילה מהצ׳אט", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "חבילה מהצ׳אט לטיוטות" });
    await dialog
      .getByLabel("קובץ החבילה מהצ׳אט", { exact: true })
      .setInputFiles({
        name: "chat-batch.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(bundle)),
      });
    await expect(
      dialog.getByText("1 מתכונים ו־1 תמונות מקור בחבילה."),
    ).toBeVisible();
    if (!attempt)
      await dialog
        .getByLabel("תמונות המקור של החבילה", { exact: true })
        .setInputFiles({
          name: "synthetic-chat-source.png",
          mimeType: "image/png",
          buffer: image,
        });
    await dialog
      .getByRole("button", { name: "ייבוא לטיוטות", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: content.title, exact: true }),
    ).toBeVisible();
  }
  const current = await (await page.request.get("/api/imports")).json();
  const matches = current.items.filter(
    (r: any) => r.draft?.title === content.title,
  );
  expect(matches).toHaveLength(1);
  expect(matches[0].status).not.toBe("saved");
  const source = await page.request.get(
    "/api/media/" + matches[0].media[0].id + "/content?variant=original",
  );
  expect(source.status()).toBe(200);
  expect(Buffer.compare(await source.body(), image)).toBe(0);
  expect((await (await page.request.get("/api/recipes")).json()).total).toBe(
    before.total,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-chat-import.png",
    fullPage: true,
  });
});
