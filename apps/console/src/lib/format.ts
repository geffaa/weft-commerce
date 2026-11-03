export function money(minor: number, currency: string) {
  const c = currency.toUpperCase();
  const exp = ["JPY", "KRW"].includes(c) ? 0 : 2;
  // Lokal per mata uang supaya USD tampil "$148.75", bukan "US$148.75".
  const locale = ({ USD: "en-US", AUD: "en-AU" } as Record<string, string>)[c] ?? "en-GB";
  return new Intl.NumberFormat(locale, { style: "currency", currency: c }).format(minor / 10 ** exp);
}
export function ago(iso: string | Date | null | undefined, now = Date.now()) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
export const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
