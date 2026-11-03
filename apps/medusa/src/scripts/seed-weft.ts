/**
 * Seed demo Halden Moto Parts: motor, fitment, kategori, 24 produk (harga per
 * wilayah), stok, dan harga tax-inclusive per wilayah. Idempotent.
 *   npx medusa exec ./src/scripts/seed-weft.ts
 */
import {
  updateRegionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows";
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils";
import type { ExecArgs } from "@medusajs/framework/types";
import { FITMENT_MODULE } from "../modules/fitment";
import type FitmentModuleService from "../modules/fitment/service";
import { BIKES, PARTS, priceFor, type BikeKey } from "../lib/catalog-data";

const CURRENCIES = ["gbp", "usd", "eur", "aud"] as const;

export default async function seedWeft({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fitment: FitmentModuleService = container.resolve(FITMENT_MODULE);

  // 1. Motor + fitment
  const bikeIds = {} as Record<BikeKey, string>;
  const existingBikes = await fitment.listBikeModels({});
  for (const [key, b] of Object.entries(BIKES) as [BikeKey, (typeof BIKES)[BikeKey]][]) {
    const found = existingBikes.find((x) => x.make === b.make && x.model === b.model && x.year_from === b.year_from);
    bikeIds[key] = found ? found.id : (await fitment.createBikeModels(b)).id;
  }
  const existingFit = new Set((await fitment.listPartFitments({})).map((f) => `${f.sku}|${f.bike_model_id}`));
  const newFit = PARTS.flatMap((p) =>
    (p.fits ?? [])
      .filter((k) => !existingFit.has(`${p.sku}|${bikeIds[k]}`))
      .map((k) => ({ sku: p.sku, bike_model_id: bikeIds[k], position: p.position ?? ("na" as const) })),
  );
  if (newFit.length) await fitment.createPartFitments(newFit);
  logger.info(`Fitment: ${Object.keys(bikeIds).length} bike models, +${newFit.length} rows`);

  // 2. Kategori
  const cats = [...new Set(PARTS.map((p) => p.category))];
  const { data: haveCats } = await query.graph({ entity: "product_category", fields: ["id", "name"] });
  const missingCats = cats.filter((c) => !haveCats.some((h) => h.name === c));
  if (missingCats.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: { product_categories: missingCats.map((name) => ({ name, is_active: true })) },
    });
    haveCats.push(...result.map((r) => ({ id: r.id, name: r.name })));
  }
  const catId = (name: string) => haveCats.find((c) => c.name === name)!.id;

  // 3. Produk
  const { data: profiles } = await query.graph({ entity: "shipping_profile", fields: ["id"] });
  const { data: channels } = await query.graph({ entity: "sales_channel", fields: ["id"] });
  const { data: existing } = await query.graph({ entity: "product_variant", fields: ["sku"] });
  const have = new Set(existing.map((v) => v.sku));
  const todo = PARTS.filter((p) => !have.has(p.sku));
  if (todo.length) {
    await createProductsWorkflow(container).run({
      input: {
        products: todo.map((p) => ({
          title: p.title,
          handle: p.sku.toLowerCase(),
          status: ProductStatus.PUBLISHED,
          category_ids: [catId(p.category)],
          shipping_profile_id: profiles[0].id,
          sales_channels: [{ id: channels[0].id }],
          metadata: { synthetic: true, spec: p.spec, position: p.position ?? null },
          options: [{ title: "Default", values: ["Default"] }],
          variants: [
            {
              title: "Default",
              sku: p.sku,
              manage_inventory: true,
              options: { Default: "Default" },
              prices: CURRENCIES.map((c) => ({ currency_code: c, amount: priceFor(p.gbp, c) })),
            },
          ],
        })),
      },
    });
  }
  logger.info(`Products: +${todo.length} (total ${PARTS.length})`);

  // 4. Stok
  const { data: locations } = await query.graph({ entity: "stock_location", fields: ["id"] });
  const { data: items } = await query.graph({ entity: "inventory_item", fields: ["id", "sku", "location_levels.id"] });
  const levels = items
    .filter((i) => !i.location_levels?.length)
    .map((i) => ({
      inventory_item_id: i.id,
      location_id: locations[0].id,
      stocked_quantity: PARTS.find((p) => p.sku === i.sku)?.stock ?? 0,
    }));
  if (levels.length) await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: levels } });
  logger.info(`Inventory levels: +${levels.length}`);

  // 5. Harga tax-inclusive per wilayah
  const pricing = container.resolve(Modules.PRICING);
  const { data: regions } = await query.graph({ entity: "region", fields: ["id", "name"] });
  // Harga disimpan per mata uang dan per wilayah; kedua atribut dibuat inklusif.
  const prefs = await pricing.listPricePreferences({});
  const targets = [
    ...regions.map((r) => ({ attribute: "region_id", value: r.id })),
    ...CURRENCIES.map((c) => ({ attribute: "currency_code", value: c })),
  ];
  for (const t of targets) {
    const pref = prefs.find((p) => p.attribute === t.attribute && p.value === t.value);
    if (!pref) await pricing.createPricePreferences({ ...t, is_tax_inclusive: true });
    else if (!pref.is_tax_inclusive) await pricing.updatePricePreferences(pref.id, { is_tax_inclusive: true });
  }
  logger.info("Price preferences: tax-inclusive per region");

  // 6. Stripe sebagai penyedia pembayaran tiap wilayah (jika dikonfigurasi)
  if (process.env.STRIPE_API_KEY) {
    for (const r of regions) {
      await updateRegionsWorkflow(container).run({
        input: { selector: { id: r.id }, update: { payment_providers: ["pp_stripe_stripe"] } },
      });
    }
    logger.info("Payment providers: pp_stripe_stripe on all regions");
  }
}
