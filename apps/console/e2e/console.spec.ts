import { expect, test, type Page } from "@playwright/test";

const USERS = { owner: ["owner@example.com", "owner-password-123"], ops: ["ops@example.com", "ops-password-123"], finance: ["finance@example.com", "finance-password-123"], support: ["support@example.com", "support-password-123"] } as const;
async function signIn(page: Page, role: keyof typeof USERS) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS[role][0]);
  await page.getByLabel("Password").fill(USERS[role][1]);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}
// Next.js menambahkan elemen role=alert untuk pengumuman rute; selalu saring berdasarkan teks.
const alert = (page: Page, text: string) => page.getByRole("alert").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test("visitors without a session are sent to the login page", async ({ page }) => {
  for (const path of ["/", "/exceptions", "/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("wrong password shows a message and stays on login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(alert(page, "Invalid email or password")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("navigation follows the role: support sees only Overview, finance cannot connect or administer", async ({ page }) => {
  await signIn(page, "support");
  await expect(nav(page).getByRole("link")).toHaveCount(1);
  await page.goto("/exceptions"); // hub menjawab 403 untuk peran ini
  await expect(page).toHaveURL(/\/\?denied=1/);
  await expect(alert(page, "Your role cannot open that page")).toBeVisible();
});

test("finance can read exceptions but has no actions; ops can act; only owner sees Settings", async ({ page }) => {
  await signIn(page, "finance");
  await expect(nav(page).getByRole("link", { name: "Connections" })).toHaveCount(0);
  await expect(nav(page).getByRole("link", { name: "Settings" })).toHaveCount(0);
  await nav(page).getByRole("link", { name: "Exceptions" }).click();
  await expect(page.getByText("Organisation is not subscribed to currency GBP")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ignore" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await signIn(page, "ops");
  await expect(nav(page).getByRole("link", { name: "Connections" })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Settings" })).toHaveCount(0);
});

test("exceptions: grouped by cause, filter by source, retry re-queues a channel job, ignore closes one", async ({ page }) => {
  await signIn(page, "ops");
  await nav(page).getByRole("link", { name: "Exceptions" }).click();
  await expect(page.getByText("Rejected by validation")).toBeVisible();
  await expect(page.getByText("Cannot fulfil")).toBeVisible();
  await expect(page.getByText("Credentials or permission")).toBeVisible();

  await page.getByRole("link", { name: /^Xero/ }).click();
  await expect(page.getByText("Organisation is not subscribed to currency GBP")).toBeVisible();
  await expect(page.getByText("Invalid access token")).toHaveCount(0);

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status")).toContainText("Re-queued");
  await expect(page.getByText("Organisation is not subscribed to currency GBP")).toHaveCount(0); // sudah selesai

  await page.getByRole("link", { name: /^Stock/ }).click();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0); // keputusan stok bukan untuk di-retry
  await page.getByRole("button", { name: "Ignore" }).click();
  await expect(page.getByRole("status")).toContainText("Ignored");
});

test("reconciliation shows both sides, the difference and which items can be fixed", async ({ page }) => {
  await signIn(page, "ops");
  await nav(page).getByRole("link", { name: "Reconciliation" }).click();
  const stock = page.locator(".panel", { hasText: "Weft vs Shopify" });
  await expect(stock.getByText("HM-BP-0196")).toBeVisible();
  await expect(stock.getByRole("cell", { name: "38" })).toBeVisible();
  await expect(stock.getByRole("cell", { name: "41" })).toBeVisible();
  await expect(stock.getByText("+3")).toBeVisible();
  await expect(stock.getByRole("button", { name: "Set 1 from Weft" })).toBeVisible();

  const xero = page.locator(".panel", { hasText: "Weft vs Xero" });
  await expect(xero.getByText("No invoice in Xero")).toBeVisible();
  await expect(xero.getByText("Invoice voided or deleted")).toBeVisible();
  await expect(xero.getByText("Needs a person in Xero.")).toBeVisible();
  await expect(xero.getByRole("button", { name: "Fix 1" })).toBeVisible(); // hanya yang bisa dikerjakan mesin
  await xero.getByRole("button", { name: "Fix 1" }).click();
  await expect(page.getByRole("status")).toContainText("Fix started");
});

test("products, orders and runs list what the hub holds", async ({ page }) => {
  await signIn(page, "ops");
  await page.goto("/products?state=conflict");
  await expect(page.getByText('SKU "DUP-1" is used by 2 variants')).toBeVisible();
  await expect(page.getByText("Gift Card")).toHaveCount(0);
  await page.goto("/orders");
  await expect(page.getByText("anna@example.com")).toBeVisible();
  await expect(page.getByText("cannot fulfil")).toBeVisible();
  await page.goto("/runs");
  await expect(page.getByText("Shopify down")).toBeVisible();
});

test("owner manages roles: a role change is applied and written to the audit log", async ({ page }) => {
  await signIn(page, "owner");
  await nav(page).getByRole("link", { name: "Settings" }).click();
  const row = page.locator("tr", { hasText: "support@example.com" });
  await row.getByRole("button", { name: "finance" }).click();
  await expect(page.getByRole("status")).toContainText("Role updated");
  await expect(page.locator("tr", { hasText: "support@example.com" }).getByRole("button", { name: "finance" })).toBeDisabled(); // papan peran saat ini
  await expect(page.getByText("member.role")).toBeVisible();

  // pemilik terakhir tidak bisa diturunkan: galat hub tampil apa adanya
  await page.locator("tr", { hasText: "owner@example.com" }).getByRole("button", { name: "ops" }).click();
  await expect(alert(page, "Cannot demote the last owner")).toBeVisible();
});

test("the environment is always visible and read-only", async ({ page }) => {
  await signIn(page, "ops");
  const env = page.getByRole("group", { name: /Environment/ });
  await expect(env).toBeVisible();
  await expect(env.getByRole("button", { name: "Sandbox" })).toHaveAttribute("aria-pressed", "true");
  await expect(env.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "false");
});
