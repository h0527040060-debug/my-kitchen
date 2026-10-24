import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "he-IL",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "node --experimental-strip-types server/index.ts",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ||
        "postgresql://kitchen:kitchen-local-dev@localhost:5432/kitchen_test",
      APP_ORIGIN: "http://127.0.0.1:3000",
      PORT: "3000",
      OPENAI_API_KEY: "",
      AI_DAILY_MAX_CALLS: "0",
    },
  },
});
