export function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(amount);
}

const IMG: Record<string, string> = {
  BP: "pads", BD: "disc", OF: "oil2", SP: "sprocket", CH: "chain", SK: "plug", AF: "air", TY: "tyre", EO: "oil",
};
export function imageFor(sku: string): string | null {
  const k = IMG[sku.split("-")[1] ?? ""];
  return k ? `/img/${k}.jpg` : null;
}
