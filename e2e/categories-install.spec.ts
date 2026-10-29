import { test, expect } from "@playwright/test";
test("phone layout has two compact recipe columns, pictured child categories and no provider controls", async ({
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
  expect(
    (
      await page.request.post("/api/categories/starter", {
        data: { confirmed: true },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await page.locator(".k-category-roots").getByRole("button", { name: "בישול", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "תתי קטגוריות בישול", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "אפייה", exact: true }).click();
  await page.getByRole("button", { name: "עוגות", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "עוגות גבינה אפויות", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "קינוחים", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "עוגות גבינה ללא אפייה", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "כל המתכונים", exact: true }).click();
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const grid = page.locator(".k-recipes-grid");
    await expect(grid).toBeVisible();
    expect(
      await grid.evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      ),
    ).toBe(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/mobile-category-cookbook.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "עוד", exact: true }).click();
  await expect(page.getByText(/מפתח OpenAI|מנועי AI ושימוש/)).toHaveCount(0);
  expect(
    (
      await page.request.post("/api/assistant", {
        data: { question: "removed" },
      })
    ).status(),
  ).toBe(404);
});
test("Android browser install event offers installation, supports deferral and hides after installation", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /ברוכים הבאים/ }),
  ).toBeVisible();
  const fire = () =>
    page.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(e, {
        prompt: async () => {
          (window as any).__installPromptCalls =
            ((window as any).__installPromptCalls || 0) + 1;
        },
        userChoice: Promise.resolve({ outcome: "accepted" }),
      });
      window.dispatchEvent(e);
    });
  await fire();
  const offer = page.getByRole("complementary", {
    name: "התקנת האפליקציה באנדרואיד",
  });
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "התקנה", exact: true }).click();
  await expect(offer).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).__installPromptCalls)).toBe(
    1,
  );
  await fire();
  await offer.getByRole("button", { name: "אחר כך", exact: true }).click();
  await fire();
  await expect(offer).not.toBeVisible();
  await page.evaluate(() => {
    localStorage.removeItem("kitchen-install-later-until");
  });
  await fire();
  await expect(offer).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(offer).not.toBeVisible();
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons) {
    const r = await page.request.get(icon.src);
    expect(r.ok()).toBe(true);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  await ctx.close();
});
