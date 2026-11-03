import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://localhost:8201", channel: "chrome", trace: "retain-on-failure" },
  webServer: [
    { command: "node e2e/start-hub.mjs", url: "http://localhost:3101/auth/me", reuseExistingServer: false, timeout: 120_000, ignoreHTTPSErrors: true, gracefulShutdown: { signal: "SIGTERM", timeout: 5000 } },
    { command: "pnpm exec next dev -p 8201", env: { HUB_URL: "http://localhost:3101" }, url: "http://localhost:8201/login", reuseExistingServer: false, timeout: 120_000 },
  ],
});
