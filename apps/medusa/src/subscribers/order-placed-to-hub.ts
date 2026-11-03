import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createHmac } from "node:crypto";

/**
 * Order Weft dari storefront -> hub (buku besar order + stok). Pembayaran Stripe di-capture saat
 * order dibuat, jadi `order.placed` berarti terbayar. Hub idempoten (event id = id order), sehingga
 * pengiriman ulang aman. Catatan: event bus Medusa lokal tidak mengulang bila hub sedang mati;
 * untuk produksi pakai event bus Redis atau outbox di sisi Medusa.
 */
export default async function orderPlacedToHub({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const url = process.env.HUB_URL;
  const secret = process.env.MEDUSA_WEBHOOK_SECRET;
  if (!url || !secret) return logger.warn("HUB_URL/MEDUSA_WEBHOOK_SECRET not set; order not forwarded to hub");

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "currency_code", "total", "email", "shipping_address.first_name", "shipping_address.last_name", "items.quantity", "items.unit_price", "items.variant_sku"],
    filters: { id: data.id },
  });
  const o = orders[0];
  if (!o) return logger.error(`order ${data.id} not found; not forwarded to hub`);

  const body = JSON.stringify({
    event: "order.paid",
    order: {
      id: o.id, currency_code: o.currency_code, total: Number(o.total), email: o.email ?? null,
      customer_name: [o.shipping_address?.first_name, o.shipping_address?.last_name].filter(Boolean).join(" ") || null,
      items: (o.items ?? []).filter((i) => i?.variant_sku).map((i) => ({
        sku: i!.variant_sku, quantity: Number(i!.quantity), unit_price: Number(i!.unit_price),
      })),
    },
  });
  const res = await fetch(`${url}/webhooks/medusa`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-weft-event-id": o.id,
      "x-weft-signature": createHmac("sha256", secret).update(body).digest("hex"),
    },
    body,
  });
  if (!res.ok) logger.error(`hub rejected order ${o.id}: ${res.status} ${await res.text()}`);
  else logger.info(`order ${o.id} forwarded to hub: ${(await res.json() as { status: string }).status}`);
}

export const config: SubscriberConfig = { event: "order.placed" };
