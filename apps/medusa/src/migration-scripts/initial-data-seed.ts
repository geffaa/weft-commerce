import { MedusaContainer } from "@medusajs/framework";
import { DEFAULT_REGION_STORE_POLICIES } from "../lib/region-store-policies";
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows";

/**
 * Weft: empat wilayah (UK/GBP, US/USD, EU/EUR, AU/AUD), pajak manual per negara,
 * satu gudang di UK, ongkir tarif tetap. Catatan: harga Medusa v2 memakai satuan
 * utama (24.9 = £24.90), bukan unit minor; konversi ke unit minor terjadi di
 * batas hub (lihat docs/TECH-SPEC.md).
 */
const REGIONS = [
  { name: "United Kingdom", currency: "gbp", countries: ["gb"] },
  { name: "United States", currency: "usd", countries: ["us"] },
  { name: "Europe", currency: "eur", countries: ["de", "fr", "es", "it", "nl"] },
  { name: "Australia", currency: "aud", countries: ["au"] },
] as const;

// Tarif manual (demo). US: tanpa pajak di demo karena sales tax bergantung negara bagian.
const TAX: Record<string, { rate: number; code: string; name: string }> = {
  gb: { rate: 20, code: "VAT", name: "UK VAT" },
  us: { rate: 0, code: "NONE", name: "No tax (demo)" },
  de: { rate: 19, code: "VAT", name: "DE VAT" },
  fr: { rate: 20, code: "VAT", name: "FR VAT" },
  es: { rate: 21, code: "VAT", name: "ES VAT" },
  it: { rate: 22, code: "VAT", name: "IT VAT" },
  nl: { rate: 21, code: "VAT", name: "NL VAT" },
  au: { rate: 10, code: "GST", name: "AU GST" },
};

// [harga standar, harga kilat] per mata uang, satuan utama.
const SHIPPING: Record<string, [number, number]> = {
  gbp: [4.95, 9.95],
  usd: [12, 24],
  eur: [9.5, 19],
  aud: [16, 32],
};

export default async function initial_data_seed({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(
    ModuleRegistrationName.FULFILLMENT
  );

  logger.info("Seeding store data...");
  const {
    result: [salesChannel],
  } = await createSalesChannelsWorkflow(container).run({
    input: {
      salesChannelsData: [
        { name: "Halden Moto storefront", description: "Own-brand web store" },
      ],
    },
  });

  const {
    result: [publishableApiKey],
  } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [
        { title: "Storefront key", type: "publishable", created_by: "" },
      ],
    },
  });
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: publishableApiKey.id, add: [salesChannel.id] },
  });

  await createStoresWorkflow(container).run({
    input: {
      stores: [
        {
          name: "Halden Moto Parts",
          supported_currencies: REGIONS.map((r, i) => ({
            currency_code: r.currency,
            is_default: i === 0,
          })),
          default_sales_channel_id: salesChannel.id,
        },
      ],
    },
  });

  logger.info("Seeding regions and tax...");
  const { result: regions } = await createRegionsWorkflow(container).run({
    input: {
      regions: REGIONS.map((r) => ({
        name: r.name,
        currency_code: r.currency,
        countries: [...r.countries],
        payment_providers: ["pp_system_default"],
        metadata: DEFAULT_REGION_STORE_POLICIES,
      })),
    },
  });

  await createTaxRegionsWorkflow(container).run({
    input: REGIONS.flatMap((r) => r.countries).map((country_code) => ({
      country_code,
      provider_id: "tp_system",
      default_tax_rate: TAX[country_code],
    })),
  });

  logger.info("Seeding stock location and fulfillment...");
  const {
    result: [stockLocation],
  } = await createStockLocationsWorkflow(container).run({
    input: {
      locations: [
        {
          name: "Halden Warehouse",
          address: { city: "Leeds", country_code: "GB", address_1: "" },
        },
      ],
    },
  });

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  });

  // Dibuat oleh migrasi inti.
  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  });
  const shippingProfile = profiles[0];

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "Halden Warehouse delivery",
    type: "shipping",
    service_zones: REGIONS.map((r) => ({
      name: r.name,
      geo_zones: r.countries.map((country_code) => ({
        country_code,
        type: "country" as const,
      })),
    })),
  });

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  });

  const rules = [
    { attribute: "enabled_in_store", value: "true", operator: "eq" as const },
    { attribute: "is_return", value: "false", operator: "eq" as const },
  ];

  await createShippingOptionsWorkflow(container).run({
    input: REGIONS.flatMap((r) => {
      const zone = fulfillmentSet.service_zones.find((z) => z.name === r.name)!;
      const region = regions.find((x) => x.name === r.name)!;
      const [standard, express] = SHIPPING[r.currency];
      const prices = (amount: number) => [
        { currency_code: r.currency, amount },
        { region_id: region.id, amount },
      ];
      return [
        {
          name: `${r.name} standard`,
          price_type: "flat" as const,
          provider_id: "manual_manual",
          service_zone_id: zone.id,
          shipping_profile_id: shippingProfile.id,
          type: { label: "Standard", description: "Tracked, 2-4 working days.", code: `standard-${r.currency}` },
          prices: prices(standard),
          rules,
        },
        {
          name: `${r.name} express`,
          price_type: "flat" as const,
          provider_id: "manual_manual",
          service_zone_id: zone.id,
          shipping_profile_id: shippingProfile.id,
          type: { label: "Express", description: "Next working day where available.", code: `express-${r.currency}` },
          prices: prices(express),
          rules,
        },
      ];
    }),
  });

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [salesChannel.id] },
  });
  logger.info("Finished seeding store, regions, tax and shipping.");
}
