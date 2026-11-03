// Merekam demo ±60 detik: storefront (My garage, fitment, keranjang, asisten) lalu konsol (Overview, Exceptions, Reconciliation, Evals).
// Butuh tumpukan dev yang berjalan (Medusa :9000, hub :3100, storefront :8100, konsol :8200) dan kredensial pemilik hub:
//   HUB_OWNER_EMAIL=... HUB_OWNER_PASSWORD=... node scripts/record-demo.mjs <direktori-keluaran>
import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, renameSync } from "node:fs";

const OUT = process.argv[2] ?? "./demo-out";
mkdirSync(OUT, { recursive: true });
const SF = "http://localhost:8100", CO = "http://localhost:8200";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
const p = await ctx.newPage();

// --- Storefront ---
await p.goto(`${SF}/c/brakes`); await wait(2200);
await p.getByRole("button", { name: /My garage/ }).click(); await wait(900);
await p.getByRole("option", { name: "Honda CB500F" }).click(); await wait(700);
await p.getByRole("option", { name: "2019" }).click(); await wait(1800);
await p.getByRole("switch", { name: "Only parts that fit" }).click(); await wait(2200);
await p.goto(`${SF}/p/hm-sp-0541`); await wait(2400);
await p.getByRole("button", { name: /Add to cart/ }).click(); await p.waitForURL(/\/cart/); await wait(3200);

// --- Asisten (model nyata) ---
await p.goto(`${SF}/p/hm-bp-0196`); await wait(1200);
await p.getByRole("button", { name: /Ask about a part/ }).click(); await wait(700);
for (const q of ["How long do I have to return a part?", "How much is HM-BP-0196 and is it in stock?"]) {
  await p.getByLabel("Your question").pressSequentially(q, { delay: 35 }); await wait(300);
  await p.getByRole("button", { name: "Send" }).click();
  await p.locator(".asst-panel .you", { hasText: q }).waitFor();
  await p.waitForFunction(() => !document.querySelector('.asst-panel [aria-busy="true"]'), null, { timeout: 30000 }); await wait(2200);
}

// --- Konsol ---
await p.goto(`${CO}/login`); await wait(600);
await p.getByLabel("Email").pressSequentially(process.env.HUB_OWNER_EMAIL, { delay: 25 });
await p.getByLabel("Password").fill(process.env.HUB_OWNER_PASSWORD); await wait(300);
await p.getByRole("button", { name: "Sign in" }).click(); await p.waitForURL(`${CO}/`); await wait(3600);
for (const [path, ms] of [["/exceptions", 3200], ["/reconciliation", 3200], ["/conversations", 2600], ["/evals", 5200]]) { await p.goto(CO + path); await wait(ms); }

await ctx.close(); await browser.close();
const file = readdirSync(OUT).find((f) => f.endsWith(".webm"));
renameSync(`${OUT}/${file}`, `${OUT}/weft-demo.webm`);
console.log("recorded", `${OUT}/weft-demo.webm`);
