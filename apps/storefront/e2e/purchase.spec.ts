import { expect, test, type Page } from "@playwright/test";

async function addBike(page: Page) {
  await page.goto("/c/brakes");
  await page.getByRole("button", { name: /My garage/ }).click();
  await page.getByRole("option", { name: "Honda CB500F" }).click();
  await page.getByRole("option", { name: "2019" }).click();
  await expect(page.getByRole("button", { name: /2019 Honda CB500F/ })).toBeVisible();
}

async function fillDetails(page: Page) {
  await page.getByLabel("Email").fill("sam.reyes@example.com");
  await page.getByLabel("First name").fill("Sam");
  await page.getByLabel("Last name").fill("Reyes");
  await page.getByLabel("Address").fill("14 Mill Lane");
  await page.getByLabel("City").fill("Hebden Bridge");
  await page.getByLabel("Postcode").fill("HX7 6AA");
  await page.getByRole("button", { name: "Continue to payment" }).click();
}

async function payWith(page: Page, card: string) {
  const frame = page.frameLocator('iframe[title*="Secure payment input"]').first();
  await frame.getByLabel("Card number").fill(card);
  await frame.getByLabel(/Expiration date/).fill("12 / 34");
  await frame.getByLabel(/Security code/).fill("123");
  const zip = frame.getByLabel(/ZIP|Postal/i);
  if (await zip.count()) await zip.fill("HX7 6AA");
}

test("fitment is shown per bike and the cart warns about a part that does not fit", async ({ page }) => {
  await addBike(page);
  const row = (name: string) => page.locator("tr", { has: page.getByRole("link", { name, exact: true }) });
  await expect(row("Sintered front brake pads, pair")).toContainText("Fits");
  await expect(row("Rear brake disc, 240 mm")).toContainText("Does not fit");
  await expect(row("Folding brake lever")).toContainText("Check fitment");

  await page.goto("/p/hm-sp-0541");
  await expect(page.getByText("Does not fit your 2019 Honda CB500F").first()).toBeVisible();
  await page.getByRole("button", { name: /Add to cart/ }).click();
  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByRole("alert").filter({ hasText: "does not fit your bike" })).toBeVisible();
});

test("out-of-stock part cannot be bought and says why", async ({ page }) => {
  await page.goto("/p/hm-cl-0505");
  await expect(page.getByRole("button", { name: "Out of stock" })).toBeDisabled();
  await expect(page.getByText(/out of stock/i).first()).toBeVisible();
});

test("price sort follows the region price, not id order", async ({ page }) => {
  await page.goto("/c/engine?sort=price-asc");
  const prices = (await page.locator("td.pc .price").allTextContents()).map((t) => Number(t.replace(/[^0-9.]/g, "")));
  expect(prices.length).toBeGreaterThan(3);
  expect(prices).toEqual([...prices].sort((a, b) => a - b));
});

test("GBP purchase with a test card creates an order", async ({ page }) => {
  await page.goto("/p/hm-bp-0196");
  await page.getByRole("button", { name: /Add to cart/ }).click();
  await expect(page).toHaveURL(/\/cart/);
  await page.getByRole("link", { name: "Go to checkout" }).click();
  await fillDetails(page);
  await expect(page.getByRole("button", { name: /^Pay £/ })).toBeVisible({ timeout: 20_000 });
  await payWith(page, "4242424242424242");
  await page.getByRole("button", { name: /^Pay £/ }).click();
  await expect(page).toHaveURL(/\/order\/order_/, { timeout: 40_000 });
  await expect(page.getByRole("heading", { name: /Order HM-\d+/ })).toBeVisible();
  await expect(page.getByText("£", { exact: false }).first()).toBeVisible();
});

test("declined card shows an error and creates no order", async ({ page }) => {
  await page.goto("/p/hm-bp-0198");
  await page.getByRole("button", { name: /Add to cart/ }).click();
  await page.getByRole("link", { name: "Go to checkout" }).click();
  await fillDetails(page);
  await expect(page.getByRole("button", { name: /^Pay £/ })).toBeVisible({ timeout: 20_000 });
  await payWith(page, "4000000000009995");
  await page.getByRole("button", { name: /^Pay £/ }).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/checkout/);
});
