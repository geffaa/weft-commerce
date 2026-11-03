import { cookies } from "next/headers";
import { medusa } from "./medusa";
import type { BikeModel, Cart, Region } from "./types";

export const COUNTRY_LABEL: Record<string, string> = { gb: "UK", us: "US", de: "EU", au: "AU" };
const DEFAULT_COUNTRY = "gb";

export async function getRegions(): Promise<Region[]> {
  return (await medusa<{ regions: Region[] }>("/store/regions")).regions;
}

export async function getRegion() {
  const regions = await getRegions();
  const c = (await cookies()).get("country")?.value ?? DEFAULT_COUNTRY;
  const region = regions.find((r) => r.countries.some((x) => x.iso_2 === c)) ?? regions[0];
  const country = region.countries.some((x) => x.iso_2 === c) ? c : region.countries[0].iso_2;
  return { region, country, regions };
}

export type Garage = { bikeId: string; year: number; label: string };
export async function getGarage(): Promise<Garage | null> {
  const raw = (await cookies()).get("garage")?.value;
  if (!raw) return null;
  try {
    const g = JSON.parse(raw);
    return typeof g.bikeId === "string" && typeof g.year === "number" ? g : null;
  } catch {
    return null;
  }
}

export async function getBikeModels(): Promise<BikeModel[]> {
  return (await medusa<{ bike_models: BikeModel[] }>("/store/bike-models")).bike_models;
}

export async function getCart(): Promise<Cart | null> {
  const id = (await cookies()).get("cart_id")?.value;
  if (!id) return null;
  try {
    return (
      await medusa<{ cart: Cart }>(
        `/store/carts/${id}?fields=*items,*items.variant,*payment_collection.payment_sessions,*shipping_address,+items.total`,
      )
    ).cart;
  } catch {
    return null;
  }
}
