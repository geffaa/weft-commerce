import { medusa } from "./medusa";
import type { FitStatus, Product } from "./types";

const FIELDS = "id,title,handle,metadata,*categories,*variants,+variants.inventory_quantity,*variants.calculated_price";

export async function listProducts(regionId: string, country: string, categoryId?: string) {
  const q = new URLSearchParams({ region_id: regionId, country_code: country, fields: FIELDS, limit: "100" });
  if (categoryId) q.set("category_id", categoryId);
  return (await medusa<{ products: Product[] }>(`/store/products?${q}`)).products;
}

export async function getProduct(handle: string, regionId: string, country: string) {
  const q = new URLSearchParams({ handle, region_id: regionId, country_code: country, fields: FIELDS });
  return (await medusa<{ products: Product[] }>(`/store/products?${q}`)).products[0] ?? null;
}

const NAV_ORDER = ["brakes", "engine", "drivetrain", "filters", "tyres", "electrics"];

export async function listCategories() {
  const { product_categories } = await medusa<{ product_categories: { id: string; name: string; handle: string }[] }>(
    "/store/product-categories?limit=50",
  );
  const rank = (h: string) => (NAV_ORDER.includes(h) ? NAV_ORDER.indexOf(h) : NAV_ORDER.length);
  return [...product_categories].sort((a, b) => rank(a.handle) - rank(b.handle) || a.name.localeCompare(b.name));
}

export async function fitmentFor(bikeId: string | undefined, skus: string[]): Promise<Record<string, FitStatus>> {
  if (!bikeId || !skus.length) return {};
  const q = new URLSearchParams({ bike_model_id: bikeId, skus: skus.join(",") });
  return (await medusa<{ status: Record<string, FitStatus> }>(`/store/fitment?${q}`)).status;
}
