export type Region = { id: string; name: string; currency_code: string; countries: { iso_2: string }[] };
export type Price = { calculated_amount: number; currency_code: string };
export type Variant = {
  id: string;
  sku: string;
  inventory_quantity?: number;
  calculated_price?: Price;
};
export type Product = {
  id: string;
  title: string;
  handle: string;
  metadata?: { spec?: string; position?: string | null } | null;
  categories?: { id: string; name: string; handle: string }[];
  variants?: Variant[];
};
export type BikeModel = { id: string; make: string; model: string; year_from: number; year_to: number; engine_cc: number };
export type FitStatus = "fits" | "no_fit" | "unknown";
export type LineItem = {
  id: string; title: string; quantity: number; unit_price: number; total: number;
  variant_sku?: string; thumbnail?: string | null; variant_id: string;
};
export type Cart = {
  id: string; currency_code: string; region_id: string; email?: string;
  items: LineItem[]; subtotal: number; shipping_total: number; tax_total: number; total: number;
  payment_collection?: { id: string; payment_sessions?: { id: string; provider_id: string; data: Record<string, unknown> }[] };
  shipping_address?: Record<string, string>;
};
