import { test, expect, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const recipes = Array.from({ length: 65 }, (_, n) => ({
  id: `scroll-fixture-${n}`,
  title: `${n < 7 ? "סלט" : "מתכון"} — נתוני בדיקת גלילה ${n}`,
  revision: 1,
  status: "published",
  favorite: false,
  primary_media_id: "scroll-test-image",
}));
async function mockKitchen(
  page: Page,
  list: (url: URL) => Promise<{ status?: number; body: unknown }>,
) {
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    if (path === "/api/session")
      return route.fulfill({ json: { email: "scroll@example.test" } });
    if (path === "/api/settings")
      return route.fulfill({
        json: { preferences: { interface_design: "sage" } },
      });
    if (path === "/api/categories" || path === "/api/cooking")
      return route.fulfill({ json: { items: [] } });
    if (path === "/api/recipes") {
      const response = await list(url);
      return route
        .fulfill({ status: response.status ?? 200, json: response.body })
        .catch(() => {});
    }
    if (path.endsWith("/favorite"))
      return route.fulfill({ json: req.postDataJSON() });
    if (path.startsWith("/api/media/"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="160"><rect width="180" height="160" fill="#839576"/></svg>',
      });
    throw new Error("Unexpected API request: " + path);
  });
}

test("infinite mobile feed appends, retries in place, selects unloaded recipes and keeps favorites stable", async ({
  page,
}) => {
  let failed = false;
  const offsets: number[] = [];
  const queries: string[] = [];
  await mockKitchen(page, async (url) => {
    const query = url.searchParams.get("q") || "";
    const items = recipes.filter((r) => r.title.includes(query));
    if (url.searchParams.get("selection") === "true")
      return { body: { items, total: items.length } };
    const offset = Number(url.searchParams.get("offset"));
    offsets.push(offset);
    queries.push(query);
    expect(url.searchParams.get("limit")).toBe("24");
    if (offset === 24 && !failed) {
      failed = true;
      return { status: 503, body: { error: "תקלה זמנית בבדיקת גלילה" } };
    }
    return {
      body: { items: items.slice(offset, offset + 24), total: items.length },
    };
  });
  await page.goto("/");
  await expect(page.locator(".k-card")).toHaveCount(24);
  await expect(
    page.getByRole("button", { name: /^(הבאים|הקודמים)$/ }),
  ).toHaveCount(0);
  const heart = page.locator(".k-card-heart").first();
  expect(await heart.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
    "rgba(0, 0, 0, 0)",
  );
  expect((await heart.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await page
    .getByRole("button", { name: "בחירה ופעולות", exact: true })
    .click();
  await page
    .getByRole("button", { name: "בחירת כל המתכונים", exact: true })
    .click();
  await expect(
    page.getByText("נבחרו 65 מתכונים", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "סיום בחירה", exact: true }).click();
  await page.locator(".k-feed-footer").scrollIntoViewIfNeeded();
  await expect(page.getByRole("alert")).toContainText("תקלה זמנית");
  await expect(page.locator(".k-card")).toHaveCount(24);
  expect(offsets).toEqual([0, 24]);
  await page.getByRole("button", { name: "ניסיון נוסף", exact: true }).click();
  await expect(page.locator(".k-card")).toHaveCount(48);
  await page.locator(".k-card-heart").first().click();
  await expect(page.locator(".k-card-heart").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".k-card")).toHaveCount(48);
  expect(offsets).toEqual([0, 24, 24]);
  await page.locator(".k-feed-footer").scrollIntoViewIfNeeded();
  await expect(page.locator(".k-card")).toHaveCount(65);
  await expect(
    page.getByText("כל המתכונים נטענו", { exact: true }),
  ).toBeVisible();
  expect(offsets).toEqual([0, 24, 24, 48]);
  expect(
    await page
      .locator(".k-card-photo")
      .evaluateAll(
        (es) => new Set(es.map((e) => e.getAttribute("aria-label"))).size,
      ),
  ).toBe(65);
  await page
    .getByRole("textbox", { name: "חיפוש מתכונים", exact: true })
    .fill("סלט");
  await page.getByRole("button", { name: "חיפוש", exact: true }).click();
  await expect(page.locator(".k-card")).toHaveCount(7);
  await expect(
    page.getByText("7 מתכונים באוסף", { exact: true }),
  ).toBeVisible();
  expect(queries.at(-1)).toBe("סלט");
  expect(offsets.at(-1)).toBe(0);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("changing filters during a pending page discards the old results", async ({
  page,
}) => {
  let release: () => void = () => {};
  let pending = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockKitchen(page, async (url) => {
    const offset = Number(url.searchParams.get("offset"));
    if (url.searchParams.get("q"))
      return { body: { items: recipes.slice(0, 3), total: 3 } };
    if (offset > 0) {
      pending = true;
      await held;
    }
    return {
      body: {
        items: recipes.slice(offset, offset + 24),
        total: recipes.length,
      },
    };
  });
  await page.goto("/");
  await expect(page.locator(".k-card")).toHaveCount(24);
  await page.locator(".k-feed-footer").scrollIntoViewIfNeeded();
  await expect.poll(() => pending).toBe(true);
  await page
    .getByRole("textbox", { name: "חיפוש מתכונים", exact: true })
    .fill("סלט");
  await page.getByRole("button", { name: "חיפוש", exact: true }).click();
  await expect(page.locator(".k-card")).toHaveCount(3);
  release();
  await expect(
    page.getByText("כל המתכונים נטענו", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".k-card")).toHaveCount(3);
});
