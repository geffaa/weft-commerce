"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { medusa } from "@/lib/medusa";
import { getRegion } from "@/lib/state";

const YEAR = 60 * 60 * 24 * 365;
const opts = { path: "/", maxAge: YEAR, sameSite: "lax" as const };

export async function setGarage(bikeId: string, year: number, label: string) {
  if (!/^bike_[A-Z0-9]+$/.test(bikeId) || !Number.isInteger(year)) return;
  (await cookies()).set("garage", JSON.stringify({ bikeId, year, label: label.slice(0, 80) }), opts);
  revalidatePath("/", "layout");
}

export async function clearGarage() {
  (await cookies()).delete("garage");
  revalidatePath("/", "layout");
}

export async function setCountry(country: string) {
  if (!["gb", "us", "de", "au"].includes(country)) return;
  const jar = await cookies();
  jar.set("country", country, opts);
  const cartId = jar.get("cart_id")?.value;
  if (cartId) {
    const { regions } = await medusa<{ regions: { id: string; countries: { iso_2: string }[] }[] }>("/store/regions");
    const region = regions.find((r) => r.countries.some((c) => c.iso_2 === country));
    if (region) {
      // Ganti wilayah menghitung ulang harga; gagal berarti keranjang dibuang agar tidak salah mata uang.
      await medusa(`/store/carts/${cartId}`, { method: "POST", body: { region_id: region.id } }).catch(() =>
        jar.delete("cart_id"),
      );
    }
  }
  revalidatePath("/", "layout");
}

async function ensureCart(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get("cart_id")?.value;
  if (existing) return existing;
  const { region, country } = await getRegion();
  const { cart } = await medusa<{ cart: { id: string } }>("/store/carts", {
    method: "POST",
    body: { region_id: region.id, shipping_address: { country_code: country } },
  });
  jar.set("cart_id", cart.id, opts);
  return cart.id;
}

export async function addToCart(variantId: string, quantity: number) {
  const q = Math.max(1, Math.min(20, Math.trunc(quantity) || 1));
  const cartId = await ensureCart();
  await medusa(`/store/carts/${cartId}/line-items`, { method: "POST", body: { variant_id: variantId, quantity: q } });
  revalidatePath("/", "layout");
  redirect("/cart");
}

export async function updateLine(itemId: string, quantity: number) {
  const cartId = (await cookies()).get("cart_id")?.value;
  if (!cartId) return;
  if (quantity < 1) await medusa(`/store/carts/${cartId}/line-items/${itemId}`, { method: "DELETE" });
  else await medusa(`/store/carts/${cartId}/line-items/${itemId}`, { method: "POST", body: { quantity: Math.min(20, quantity) } });
  revalidatePath("/cart");
  revalidatePath("/", "layout");
}

/* ---------- Checkout ---------- */
type Details = {
  email: string; first_name: string; last_name: string; address_1: string;
  city: string; postal_code: string; country_code: string; option_id: string;
};
const COUNTRIES: Record<string, string> = { gb: "United Kingdom", us: "United States", de: "Germany", fr: "France", es: "Spain", it: "Italy", nl: "Netherlands", au: "Australia" };
export async function countryName(c: string) { return COUNTRIES[c] ?? c.toUpperCase(); }

export async function submitDetails(d: Details): Promise<{ ok: true; clientSecret: string; total: number; currency: string } | { ok: false; error: string }> {
  const cartId = (await cookies()).get("cart_id")?.value;
  if (!cartId) return { ok: false, error: "Your cart is empty." };
  if (!/^\S+@\S+\.\S+$/.test(d.email)) return { ok: false, error: "Enter a valid email address." };
  for (const k of ["first_name", "last_name", "address_1", "city", "postal_code"] as const)
    if (!d[k].trim()) return { ok: false, error: "Fill in every address field." };
  try {
    await medusa(`/store/carts/${cartId}`, {
      method: "POST",
      body: {
        email: d.email,
        shipping_address: { first_name: d.first_name, last_name: d.last_name, address_1: d.address_1, city: d.city, postal_code: d.postal_code, country_code: d.country_code },
        billing_address: { first_name: d.first_name, last_name: d.last_name, address_1: d.address_1, city: d.city, postal_code: d.postal_code, country_code: d.country_code },
      },
    });
    await medusa(`/store/carts/${cartId}/shipping-methods`, { method: "POST", body: { option_id: d.option_id } });
    const { cart } = await medusa<{ cart: { total: number; currency_code: string; payment_collection?: { id: string } } }>(`/store/carts/${cartId}?fields=+total,*payment_collection`);
    const pcId = cart.payment_collection?.id ?? (await medusa<{ payment_collection: { id: string } }>("/store/payment-collections", { method: "POST", body: { cart_id: cartId } })).payment_collection.id;
    const { payment_collection } = await medusa<{ payment_collection: { payment_sessions: { data: { client_secret?: string } }[] } }>(
      `/store/payment-collections/${pcId}/payment-sessions`, { method: "POST", body: { provider_id: "pp_stripe_stripe" } });
    const secret = payment_collection.payment_sessions[0]?.data.client_secret;
    if (!secret) return { ok: false, error: "Payment could not be started. Try again." };
    return { ok: true, clientSecret: secret, total: cart.total, currency: cart.currency_code };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

export async function shippingOptions() {
  const cartId = (await cookies()).get("cart_id")?.value;
  if (!cartId) return [];
  const { shipping_options } = await medusa<{ shipping_options: { id: string; name: string; amount: number; type?: { label?: string; description?: string } }[] }>(
    `/store/shipping-options?cart_id=${cartId}`);
  return shipping_options;
}

/** Selesaikan cart setelah Stripe mengonfirmasi. Pesanan baru dibuat di sini, bukan sebelum bayar. */
export async function completeOrder(): Promise<{ ok: true; orderId: string } | { ok: false; error: string }> {
  const jar = await cookies();
  const cartId = jar.get("cart_id")?.value;
  if (!cartId) return { ok: false, error: "Cart not found." };
  try {
    const r = await medusa<{ type: string; order?: { id: string }; error?: { message?: string } }>(`/store/carts/${cartId}/complete`, { method: "POST", body: {} });
    if (r.type === "order" && r.order) {
      jar.delete("cart_id");
      revalidatePath("/", "layout");
      return { ok: true, orderId: r.order.id };
    }
    return { ok: false, error: r.error?.message ?? "Payment is not confirmed yet." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not complete the order." };
  }
}
