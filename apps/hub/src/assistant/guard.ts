/**
 * Pagar pengaman di lapisan kode (bukan di prompt): angka harga/stok dalam jawaban harus berasal dari hasil alat
 * atau dari teks dokumen yang dikutip, dan jawaban kebijakan harus mengutip sumber.
 */
export type NumberClaim = { kind: "money" | "stock"; text: string; value: number | null };

const MONEY = /(?:[£$€]|A\$)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:pounds?|euros?|dollars?|gbp|usd|eur|aud)\b/gi;
const STOCK_COUNT = /(\d[\d,]*)\s+(?:units?\s+|pieces?\s+|parts?\s+)?(?:in stock|left|available|remaining|on hand)\b/gi;
const STOCK_WORDS = /\b(in stock|out of stock|sold out|low stock|only \d+ left|available now|can ship today)\b/i;

const num = (s: string) => Number(s.replace(/,/g, ""));

export function extractClaims(answer: string): NumberClaim[] {
  const claims: NumberClaim[] = [];
  for (const m of answer.matchAll(MONEY)) claims.push({ kind: "money", text: m[0], value: num(m[1] ?? m[2]) });
  for (const m of answer.matchAll(STOCK_COUNT)) claims.push({ kind: "stock", text: m[0], value: num(m[1]) });
  if (STOCK_WORDS.test(answer) && !claims.some((c) => c.kind === "stock")) claims.push({ kind: "stock", text: answer.match(STOCK_WORDS)![0], value: null });
  return claims;
}

/** Semua angka yang muncul dalam teks (untuk mencocokkan klaim dengan sumber yang sah). */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(num(m[0]));
  return out;
}

export type GuardInput = { answer: string; toolNumbers: Set<number>; toolHasStock: boolean; citedText: string };
export type GuardResult = { violations: NumberClaim[] };

/**
 * Klaim uang: angkanya harus ada di hasil alat atau di teks dokumen yang dikutip (mis. ambang ongkir gratis).
 * Klaim stok: hanya sah bila alat harga/stok dipanggil. Angka tanpa sumber = pelanggaran.
 */
export function checkNumbers({ answer, toolNumbers, toolHasStock, citedText }: GuardInput): GuardResult {
  const cited = numbersIn(citedText);
  const violations: NumberClaim[] = [];
  for (const c of extractClaims(answer)) {
    if (c.kind === "stock") {
      if (!toolHasStock || (c.value !== null && !toolNumbers.has(c.value))) violations.push(c);
    } else if (c.value !== null && !toolNumbers.has(c.value) && !cited.has(c.value)) violations.push(c);
  }
  return { violations };
}
