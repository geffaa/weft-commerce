import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1,
  use: { baseURL: "http://localhost:8100", channel: "chrome", trace: "retain-on-failure" },
  webServer: [
    { command: "pnpm --filter @weft/medusa dev", url: "http://localhost:9000/health", reuseExistingServer: true, timeout: 180_000, cwd: "../.." },
    { command: "pnpm dev", url: "http://localhost:8100", reuseExistingServer: true, timeout: 120_000 },
  ],
});
