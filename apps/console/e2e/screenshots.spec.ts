import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Menghasilkan tangkapan layar untuk README dari data FIXTURE E2E (sintetis; bukan data nyata). Hanya jalan dengan CAPTURE=1.
// Halaman yang menampilkan hasil nyata (Overview, Evals) diambil dari konsol dev, bukan dari fixture ini.
//
//   CAPTURE=1 pnpm e2e e2e/screenshots.spec.ts
const OUT = resolve(__dirname, "../../../docs/screenshots") + "/";
test.skip(!process.env.CAPTURE, "set CAPTURE=1 to regenerate README screenshots");
test.use({ viewport: { width: 1440, height: 900 } });

test("capture console screenshots", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com"); await page.getByLabel("Password").fill("owner-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  const shots: [string, string][] = [["console-exceptions", "/exceptions"], ["console-reconciliation", "/reconciliation"], ["console-conversations", "/conversations"], ["console-settings", "/settings"]];
  for (const [name, path] of shots) { await page.goto(path); await page.waitForLoadState("networkidle"); await page.screenshot({ path: `${OUT}${name}.png` }); }
  await page.goto("/conversations"); await page.getByRole("link", { name: "How long do I have to return a part?" }).click();
  await page.waitForLoadState("networkidle"); await page.screenshot({ path: `${OUT}console-transcript.png` });
});
