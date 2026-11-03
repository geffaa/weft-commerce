import { z } from "zod";
import { exponent } from "@weft/shared";
import type { OrderInput } from "../ledger/ledger.service";

const toMinor = (v: string | number, currency: string) => Math.round(Number(v) * 10 ** exponent(currency));

const shopifyOrder = z.object({
  id: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  total_price: z.union([z.string(), z.number()]),
  email: z.string().nullish(),
  name: z.string().nullish(),
  customer: z.object({ first_name: z.string().nullish(), last_name: z.string().nullish() }).nullish(),
  line_items: z.array(z.object({ sku: z.string().nullable(), quantity: z.number().int().positive(), price: z.union([z.string(), z.number()]) })),
});

export function parseShopifyOrder(body: unknown): OrderInput {
  const o = shopifyOrder.parse(body);
  const cur = o.currency.toUpperCase();
  const missing = o.line_items.filter((l) => !l.sku);
  if (missing.length) throw new Error("Order has line items without SKU; cannot map to stock");
  return {
    source: "shopify", sourceRef: String(o.id), currency: cur, totalMinor: toMinor(o.total_price, cur),
    customerEmail: o.email?.trim() || null, orderNumber: o.name?.trim() || null,
    customerName: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || null,
    lines: o.line_items.map((l) => ({ sku: l.sku!, qty: l.quantity, unitMinor: toMinor(l.price, cur) })),
  };
}

// Medusa v2 memakai satuan utama (24.9 = £24.90); diubah ke unit minor di batas ini.
const medusaOrder = z.object({
  event: z.literal("order.paid"),
  order: z.object({
    id: z.string(), currency_code: z.string().length(3), total: z.number(), email: z.string().nullish(), customer_name: z.string().nullish(), display_id: z.number().int().nullish(),
    items: z.array(z.object({ sku: z.string(), quantity: z.number().int().positive(), unit_price: z.number() })),
  }),
});

export function parseMedusaOrder(body: unknown): OrderInput {
  const { order } = medusaOrder.parse(body);
  const cur = order.currency_code.toUpperCase();
  return {
    source: "storefront", sourceRef: order.id, currency: cur, totalMinor: toMinor(order.total, cur),
    customerEmail: order.email?.trim() || null, customerName: order.customer_name?.trim() || null,
    orderNumber: order.display_id ? `HM-${order.display_id}` : null,
    lines: order.items.map((l) => ({ sku: l.sku, qty: l.quantity, unitMinor: toMinor(l.unit_price, cur) })),
  };
}
