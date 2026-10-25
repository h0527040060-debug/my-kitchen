import { test, expect } from "@playwright/test";
import { emptyRecipe } from "../shared/model.ts";
test("three mobile designs are browsable, compact and saved only on explicit choice", async ({
  page,
}) => {
  await page.goto("/designs");
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
  const cats = (await (await page.request.get("/api/categories")).json()).items;
  for (const [n, title] of [
    "עוגת שוקולד רכה",
    "סלט ירוק קצוץ",
    "עוגיות מהתנור",
    "דג אפוי בלימון",
  ].entries()) {
    const data = {
      content: {
        ...emptyRecipe(),
        title: title + " — נתוני בדיקה",
        active_minutes: 10 + n * 5,
        total_minutes: 30 + n * 10,
      },
      status: "published",
      category_ids: [],
      confirm_categories: true,
    };
    const r = await (await page.request.post("/api/recipes", { data })).json();
    const media = cats.find(
      (c: any) => c.name === ["עוגות שוקולד", "סלטים", "עוגיות", "דגים"][n],
    )?.media_id;
    if (media)
      expect(
        (
          await page.request.post("/api/recipes/" + r.id + "/media", {
            data: { media_id: media, primary: true, position: 0 },
          })
        ).ok(),
      ).toBe(true);
  }
  await page.reload();
  const before = (await (await page.request.get("/api/settings")).json())
    .preferences.interface_design;
  for (const [name, id] of [
    ["1. מרווה", "sage"],
    ["2. לילה", "night"],
    ["3. נקי וחד", "paper"],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".kitchen")).toHaveAttribute("data-design", id);
    expect(
      (await (await page.request.get("/api/settings")).json()).preferences
        .interface_design,
    ).toBe(before);
    await expect(page.locator(".k-card").first()).toBeVisible();
    expect(
      await page
        .locator(".k-recipes-grid")
        .evaluate(
          (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
        ),
    ).toBe(2);
    expect(
      await page
        .locator(".k-card")
        .first()
        .boundingBox()
        .then((r) => r!.y),
    ).toBeLessThan(620);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/design-${id}.png`,
      fullPage: false,
    });
    await page.locator(".k-card-photo").first().click();
    await expect(
      page.getByRole("heading", { name: /נתוני בדיקה/ }),
    ).toBeVisible();
    await expect(page.locator(".kitchen")).toHaveAttribute("data-design", id);
    await page.getByRole("button", { name: "מתכונים", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "בחירה בעיצוב הזה", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("נשמר");
  expect(
    (await (await page.request.get("/api/settings")).json()).preferences
      .interface_design,
  ).toBe("paper");
  await page.request.put("/api/appearance", { data: { design: "sage" } });
});
