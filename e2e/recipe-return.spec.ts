import { test, expect, type Page } from "@playwright/test";
import { emptyRecipe } from "../shared/model.ts";

test.use({ serviceWorkers: "block" });
const recipes = Array.from({ length: 65 }, (_, n) => ({
  id: "navigation-fixture-" + n,
  title: "נתוני בדיקת חזרה " + n,
  revision: 1, status: "published", favorite: false, primary_media_id: null,
}));
async function kitchen(page: Page) {
  const currentRecipes = recipes.map(r => ({ ...r }));
  const requests: URL[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === "/api/session") return route.fulfill({ json: { email: "navigation@example.test" } });
    if (path === "/api/settings") return route.fulfill({ json: { preferences: { interface_design: "sage" } } });
    if (path === "/api/categories") return route.fulfill({ json: { items: [
      { id: "root", name: "בישול", parent_id: null, recipe_count: 65 },
      { id: "child", name: "סלטים", parent_id: "root", recipe_count: 65 },
    ] } });
    if (path === "/api/cooking") return route.fulfill({ json: { items: [] } });
    if (path === "/api/logout") return route.fulfill({ json: { ok: true } });
    if (path === "/api/recipes") {
      requests.push(url);
      const offset = Number(url.searchParams.get("offset"));
      return route.fulfill({ json: { items: currentRecipes.slice(offset, offset + 24), total: currentRecipes.length } });
    }
    const id = path.match(/^\/api\/recipes\/([^/]+)$/)?.[1];
    if (id) {
      const recipe = currentRecipes.find(r => r.id === id)!;
      if (request.method() === "PUT") {
        recipe.title = request.postDataJSON().content.title;
        recipe.revision++;
        return route.fulfill({ json: { id: recipe.id } });
      }
      return route.fulfill({ json: {
        recipe: { ...recipe, content: { ...emptyRecipe(), title: recipe.title }, category_ids: [] },
        media: [], experiences: [], versions: [],
      } });
    }
    throw new Error("Unexpected request: " + path);
  });
  return { requests, errors };
}

test("returning by app back, browser back and forward retains a deep filtered recipe list", async ({ page }) => {
  const { requests, errors } = await kitchen(page);
  await page.goto("/");
  await expect(page.locator(".k-card")).toHaveCount(24);
  await page.getByRole("button", { name: "סלטים", exact: true }).click();
  await page.getByRole("textbox", { name: "חיפוש מתכונים", exact: true }).fill("נתוני");
  await page.getByRole("button", { name: "חיפוש", exact: true }).click();
  await page.getByText("סינון ומיון", { exact: true }).click();
  await page.getByRole("combobox", { name: "מיון", exact: true }).selectOption("name");
  await expect.poll(() => requests.at(-1)?.searchParams.get("sort")).toBe("name");
  await expect(page.locator(".k-card")).toHaveCount(24);
  await page.locator(".k-feed-footer").scrollIntoViewIfNeeded();
  await expect(page.locator(".k-card")).toHaveCount(48);
  const card = page.locator(".k-card-photo").nth(31);
  await card.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => scrollY);
  const count = requests.length;
  expect(position).toBeGreaterThan(1000);
  const checkReturn = async () => {
    await expect(card).toBeVisible();
    await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThanOrEqual(2);
    await expect(page.locator(".k-card")).toHaveCount(48);
    expect(requests.length).toBe(count);
    await expect(page.getByRole("textbox", { name: "חיפוש מתכונים", exact: true })).toHaveValue("נתוני");
    await expect(page.getByRole("combobox", { name: "מיון", exact: true })).toHaveValue("name");
    await expect(page.getByRole("combobox", { name: "קטגוריה ותת־קטגוריה", exact: true })).toHaveValue("child");
    expect(await page.locator(".k-filters").evaluate(e => (e as HTMLDetailsElement).open)).toBe(true);
  };
  await card.click();
  await expect(page.getByRole("heading", { name: recipes[31].title, exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole("button", { name: "חזרה", exact: true }).click();
  await checkReturn();
  await card.click();
  await expect(page.getByRole("heading", { name: recipes[31].title, exact: true })).toBeVisible();
  await page.goBack();
  await checkReturn();
  await page.goForward();
  await expect(page.getByRole("heading", { name: recipes[31].title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "חזרה", exact: true }).click();
  await checkReturn();
  // Continuing after a restored list still uses its existing pagination cursor.
  await page.locator(".k-feed-footer").scrollIntoViewIfNeeded();
  await expect(page.locator(".k-card")).toHaveCount(65);
  expect(requests.at(-1)?.searchParams.get("offset")).toBe("48");
  expect(errors).toEqual([]);
});

test("source collection return preserves its route and clears retained recipes on sign out", async ({ page }) => {
  const { requests, errors } = await kitchen(page);
  await page.goto("/#/recipes?source=fixture-source");
  await expect(page.locator(".k-card")).toHaveCount(24);
  await page.setViewportSize({ width: 320, height: 740 });
  const card = page.locator(".k-card-photo").nth(10);
  await card.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => scrollY);
  const count = requests.length;
  await card.click();
  await expect(page.getByRole("heading", { name: recipes[10].title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "חזרה", exact: true }).click();
  await expect(page).toHaveURL(/#\/recipes\?source=fixture-source$/);
  await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThanOrEqual(2);
  expect(requests.length).toBe(count);
  expect(requests.every(url => url.searchParams.get("source") === "fixture-source")).toBe(true);
  await page.getByRole("button", { name: "יציאה מהחשבון", exact: true }).click();
  await expect(page.getByRole("heading", { name: /ברוכים הבאים/ })).toBeVisible();
  await expect(page.locator(".k-card")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a direct recipe link has a safe back destination", async ({ page }) => {
  const { errors } = await kitchen(page);
  await page.goto("/#/recipes/" + recipes[0].id);
  await expect(page.getByRole("heading", { name: recipes[0].title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "חזרה", exact: true }).click();
  await expect(page).toHaveURL(/#\/recipes$/);
  await expect(page.locator(".k-card")).toHaveCount(24);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  expect(errors).toEqual([]);
});

test("saving an edited recipe refreshes the retained list and restores its deep position", async ({ page }) => {
  const { errors } = await kitchen(page);
  await page.goto("/");
  await expect(page.locator(".k-card")).toHaveCount(24);
  await page.locator(".k-feed-footer").scrollIntoViewIfNeeded();
  await expect(page.locator(".k-card")).toHaveCount(48);
  const card = page.locator(".k-card-photo").nth(31);
  await card.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => scrollY);
  await card.click();
  await expect(page.getByRole("heading", { name: recipes[31].title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "עריכה", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "עריכת מתכון", exact: true });
  const editedTitle = "מתכון מעודכן — נתוני בדיקת חזרה";
  await editor.getByLabel("שם המתכון", { exact: true }).fill(editedTitle);
  await editor.getByRole("button", { name: "אישור ושמירת מתכון", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole("heading", { name: editedTitle, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "חזרה", exact: true }).click();
  await expect(page.getByRole("button", { name: "פתיחת " + editedTitle, exact: true })).toBeVisible();
  await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});
