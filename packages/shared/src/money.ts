// Uang selalu bilangan bulat unit minor + kode ISO 4217 (lihat TECH-SPEC).
export const REGIONS = {
  US: "USD",
  UK: "GBP",
  EU: "EUR",
  AU: "AUD",
} as const;

export type RegionCode = keyof typeof REGIONS;

const EXPONENT: Record<string, number> = { JPY: 0, KRW: 0 };

export function exponent(currency: string): number {
  return EXPONENT[currency] ?? 2;
}

export function formatMinor(minor: number, currency: string, locale = "en-GB"): string {
  if (!Number.isInteger(minor)) throw new Error("minor units must be an integer");
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    minor / 10 ** exponent(currency),
  );
}
