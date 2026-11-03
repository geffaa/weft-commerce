/**
 * Mengisi toko dev Shopify dengan produk Halden Moto (idempoten, aman diulang).
 * Sengaja memuat masalah nyata agar halaman Products menampilkannya:
 *   - dua produk dengan SKU kembar (HM-DUP-0001) -> state "conflict"
 *   - satu produk tanpa SKU                        -> state "missing"
 * Butuh scope write_products. Jalankan: pnpm --filter @weft/hub exec tsx scripts/seed-shopify.ts
 */
import { ShopifyClient } from "../src/shopify/shopify.client";

const PRODUCTS = [
  { handle: "hm-bp-0196", title: "Sintered front brake pads, pair", sku: "HM-BP-0196", price: "31.60", quantity: 30 },
  { handle: "hm-of-0112", title: "Oil filter, spin-on", sku: "HM-OF-0112", price: "10.00", quantity: 120 },
  { handle: "hm-ch-0520", title: "O-ring chain, 520 x 114", sku: "HM-CH-0520", price: "74.93", quantity: 25 },
  { handle: "hm-sk-0033", title: "Iridium spark plugs, set of 2", sku: "HM-SK-0033", price: "26.67", quantity: 47 },
  { handle: "hm-fluid-dot4-500", title: "Brake fluid DOT 4, 500 ml", sku: "HM-DUP-0001", price: "12.70", quantity: 40 },
  { handle: "hm-fluid-dot4-1l", title: "Brake fluid DOT 4, 1 L", sku: "HM-DUP-0001", price: "21.50", quantity: 18 },
  { handle: "halden-workshop-towel", title: "Halden workshop towel", sku: null, price: "6.00", quantity: 60 },
];

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
const client = new ShopifyClient({ shop: need("SHOPIFY_SHOP"), clientId: need("SHOPIFY_CLIENT_ID"), clientSecret: need("SHOPIFY_CLIENT_SECRET") });
const location = (await client.locations()).find((l) => l.name === (process.env.SHOPIFY_LOCATION ?? "Shop location"));
if (!location) throw new Error("Location not found");

let created = 0, skipped = 0;
for (const p of PRODUCTS) {
  if (await client.findProductByHandle(p.handle)) { skipped++; continue; }
  await client.createSimpleProduct({ ...p, locationId: location.id });
  created++; console.log("created", p.handle);
}
console.log(`done: ${created} created, ${skipped} already there`);
