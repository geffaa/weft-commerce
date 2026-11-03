import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { formatMinor } from "@weft/shared";
import { DB, type Db } from "../db/db";
import { ledgerLine, ledgerOrder } from "../db/schema";
import { ENV } from "../common/tokens";
import type { Env } from "../common/env";
import { InventoryService } from "../ledger/inventory.service";

export type PriceStock =
  | { found: false; sku: string }
  | { found: true; sku: string; title: string; region: string; currency: string; priceMinor: number | null; priceDisplay: string | null; stock: number; inStock: boolean };
export type OrderInfo =
  | { found: false }
  | { found: true; number: string; status: "preparing" | "needs_attention"; statusText: string; items: number; totalDisplay: string };

type MedusaRegion = { id: string; currency_code: string; countries: { iso_2: string }[] };
export const COUNTRY_BY_REGION: Record<string, string> = { UK: "gb", US: "us", EU: "de", AU: "au" };
/** Format uang seperti yang dilihat pembeli di wilayahnya ("$31.60", bukan "US$31.60"). */
const localeFor = (currency: string) => ({ USD: "en-US", AUD: "en-AU" } as Record<string, string>)[currency] ?? "en-GB";
const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

@Injectable()
export class AssistantTools {
  private regions?: MedusaRegion[];
  constructor(@Inject(DB) private readonly db: Db, @Inject(ENV) private readonly env: Env, @Inject(InventoryService) private readonly inventory: InventoryService) {}

  private async medusa<T>(path: string): Promise<T> {
    const r = await fetch(this.env.MEDUSA_URL + path, { headers: { "x-publishable-api-key": this.env.MEDUSA_PUBLISHABLE_KEY ?? "" } });
    return (await r.json()) as T;
  }

  /** Stok dari buku besar Weft (sumber kebenaran); harga dari Medusa untuk wilayah pembeli. */
  async getPriceStock(sku: string, region = "UK"): Promise<PriceStock> {
    const clean = sku.trim().toUpperCase();
    const stock = await this.inventory.stock(clean);
    let title = clean, priceMinor: number | null = null, currency = "GBP", known = false;
    if (this.env.MEDUSA_URL) {
      const regions = (this.regions ??= (await this.medusa<{ regions: MedusaRegion[] }>("/store/regions")).regions);
      const country = COUNTRY_BY_REGION[region.toUpperCase()] ?? "gb";
      const reg = regions.find((r) => r.countries.some((c) => c.iso_2 === country)) ?? regions[0];
      const q = new URLSearchParams({ handle: clean.toLowerCase(), region_id: reg.id, country_code: country, fields: "title,*variants.calculated_price" });
      const p = (await this.medusa<{ products: { title: string; variants: { calculated_price?: { calculated_amount: number; currency_code: string } }[] }[] }>(`/store/products?${q}`)).products[0];
      if (p) {
        known = true; title = p.title; currency = (p.variants[0]?.calculated_price?.currency_code ?? reg.currency_code).toUpperCase();
        const amt = p.variants[0]?.calculated_price?.calculated_amount;
        priceMinor = amt === undefined ? null : Math.round(amt * (["JPY", "KRW"].includes(currency) ? 1 : 100));
      }
    } else known = stock > 0;
    if (!known) return { found: false, sku: clean };
    return { found: true, sku: clean, title, region: region.toUpperCase(), currency, priceMinor, priceDisplay: priceMinor === null ? null : formatMinor(priceMinor, currency, localeFor(currency)), stock, inStock: stock > 0 };
  }

  /**
   * Butuh nomor pesanan DAN email yang cocok. Jawaban minimal: status, jumlah barang, total. Tidak pernah alamat.
   * Tidak membedakan "nomor salah" dari "email salah" agar tak bisa dipakai menebak pesanan orang lain.
   */
  async lookupOrder(number: string, email: string): Promise<OrderInfo> {
    const n = normalize(number);
    if (!n || !email.trim()) return { found: false };
    const [o] = await this.db.select().from(ledgerOrder).where(and(
      sql`regexp_replace(upper(coalesce(${ledgerOrder.orderNumber}, '')), '[^A-Z0-9]', '', 'g') = ${n}`,
      sql`lower(coalesce(${ledgerOrder.customerEmail}, '')) = ${email.trim().toLowerCase()}`,
    )).limit(1);
    if (!o) return { found: false };
    const [{ items }] = await this.db.select({ items: sql<number>`coalesce(sum(${ledgerLine.qty}), 0)::int` }).from(ledgerLine).where(eq(ledgerLine.orderId, o.id));
    const ok = o.status === "accepted";
    return {
      found: true, number: o.orderNumber ?? number, status: ok ? "preparing" : "needs_attention",
      statusText: ok ? "Payment confirmed. Your order is being prepared." : "We are checking stock for your order, and a person will contact you.",
      items, totalDisplay: formatMinor(o.totalMinor, o.currency, localeFor(o.currency)),
    };
  }
}
