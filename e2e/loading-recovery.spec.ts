import { test, expect } from "@playwright/test";
test.use({ serviceWorkers: "block" });
for (const target of ["/api/session", "/api/recipes"])
  for (const manual of [true, false])
    test(
      target +
        (manual
          ? " stalled request can be restarted before its deadline"
          : " stalled request stops loading and allows retry"),
      async ({ page }) => {
        await page.clock.install();
        let attempts = 0;
        let release: () => void = () => {};
        const held = new Promise<void>((r) => {
          release = r;
        });
        await page.route("**/api/**", async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === target) {
            attempts++;
            if (attempts === 1) {
              await held;
              return route
                .fulfill({ json: { items: [], total: 0 } })
                .catch(() => {});
            }
          }
          if (path === "/api/session")
            return route.fulfill({ json: { email: "recovery@example.test" } });
          if (path === "/api/settings")
            return route.fulfill({
              json: { preferences: { interface_design: "sage" } },
            });
          if (path === "/api/categories" || path === "/api/cooking")
            return route.fulfill({ json: { items: [] } });
          if (path === "/api/recipes") {
            return route.fulfill({
              json: {
                items: [
                  {
                    id: "recovery-fixture",
                    title: "מתכון בדיקת התאוששות",
                    status: "published",
                    revision: 1,
                    primary_media_id: null,
                  },
                ],
                total: 1,
              },
            });
          }
          throw Error("Unexpected API request " + path);
        });
        await page.goto("/");
        await expect.poll(() => attempts).toBe(1);
        await expect(
          page.getByText("פותחים את המטבח…", { exact: true }),
        ).toBeVisible();
        await page.clock.fastForward(manual ? 8001 : 25001);
        if (manual) {
          await page
            .getByRole("button", { name: "טעינה מחדש", exact: true })
            .click();
        } else {
          await expect(page.getByRole("alert")).toContainText("הטעינה התעכבה");
          await expect(
            page.getByText("פותחים את המטבח…", { exact: true }),
          ).toHaveCount(0);
          await page
            .getByRole("button", { name: "ניסיון נוסף", exact: true })
            .click();
        }
        await expect(page.locator(".k-card")).toHaveCount(1);
        await expect(
          page.getByRole("button", {
            name: "פתיחת מתכון בדיקת התאוששות",
            exact: true,
          }),
        ).toBeVisible();
        release();
        await expect(page.locator(".k-card")).toHaveCount(1);
        expect(attempts).toBe(2);
      },
    );
