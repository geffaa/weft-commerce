/** Data demo sintetis Halden Moto Parts. Fitment fiktif. Harga GBP dalam satuan utama. */
export type BikeKey = "H1" | "H2" | "H3" | "Y1" | "Y2" | "K" | "T" | "S" | "D";

export const BIKES: Record<BikeKey, { make: string; model: string; year_from: number; year_to: number; engine_cc: number }> = {
  H1: { make: "Honda", model: "CB500F", year_from: 2013, year_to: 2015, engine_cc: 471 },
  H2: { make: "Honda", model: "CB500F", year_from: 2016, year_to: 2018, engine_cc: 471 },
  H3: { make: "Honda", model: "CB500F", year_from: 2019, year_to: 2021, engine_cc: 471 },
  Y1: { make: "Yamaha", model: "MT-07", year_from: 2014, year_to: 2020, engine_cc: 689 },
  Y2: { make: "Yamaha", model: "MT-07", year_from: 2021, year_to: 2024, engine_cc: 689 },
  K: { make: "Kawasaki", model: "Z650", year_from: 2017, year_to: 2023, engine_cc: 649 },
  T: { make: "Triumph", model: "Street Triple 765", year_from: 2017, year_to: 2022, engine_cc: 765 },
  S: { make: "Suzuki", model: "SV650", year_from: 2016, year_to: 2024, engine_cc: 645 },
  D: { make: "Ducati", model: "Monster 821", year_from: 2018, year_to: 2020, engine_cc: 821 },
};

export type Part = {
  sku: string;
  title: string;
  category: "Brakes" | "Engine" | "Drivetrain" | "Filters" | "Tyres" | "Electrics";
  gbp: number;
  /** undefined = tidak ada data fitment (status "Check fitment"). */
  fits?: BikeKey[];
  position?: "front" | "rear";
  stock: number;
  spec: string;
};

const CB: BikeKey[] = ["H1", "H2", "H3"];

export const PARTS: Part[] = [
  { sku: "HM-BP-0196", title: "Sintered front brake pads, pair", category: "Brakes", gbp: 24.9, fits: CB, position: "front", stock: 38, spec: "Sintered, FA-type compound" },
  { sku: "HM-BP-0198", title: "Organic front brake pads, pair", category: "Brakes", gbp: 18.5, fits: CB, position: "front", stock: 22, spec: "Organic, quiet" },
  { sku: "HM-BP-0240", title: "Sintered rear brake pads, pair", category: "Brakes", gbp: 16.9, fits: CB, position: "rear", stock: 9, spec: "Sintered" },
  { sku: "HM-BP-0310", title: "Sintered front brake pads, pair (twin-pot)", category: "Brakes", gbp: 26.4, fits: ["Y1", "Y2"], position: "front", stock: 31, spec: "Sintered" },
  { sku: "HM-BD-0320", title: "Front brake disc, 320 mm", category: "Brakes", gbp: 89, fits: ["Y1", "Y2", "K"], position: "front", stock: 6, spec: "320 mm, floating" },
  { sku: "HM-BD-0296", title: "Rear brake disc, 240 mm", category: "Brakes", gbp: 48, fits: ["K", "S"], position: "rear", stock: 12, spec: "240 mm" },
  { sku: "HM-OF-0112", title: "Oil filter, spin-on", category: "Engine", gbp: 7.9, fits: ["H1", "H2", "H3", "K", "S"], stock: 140, spec: "Spin-on, 500-650 cc" },
  { sku: "HM-OF-0200", title: "Oil filter, cartridge", category: "Engine", gbp: 9.4, fits: ["Y1", "Y2"], stock: 64, spec: "Cartridge" },
  { sku: "HM-SK-0033", title: "Iridium spark plugs, set of 2", category: "Engine", gbp: 21, fits: ["H1", "H2", "H3", "Y1", "Y2"], stock: 47, spec: "Iridium, 0.8 mm gap" },
  { sku: "HM-GK-0450", title: "Clutch cover gasket", category: "Engine", gbp: 14.2, fits: ["T", "D"], stock: 15, spec: "Composite" },
  { sku: "HM-EO-1040", title: "10W-40 semi-synthetic engine oil, 4 L", category: "Engine", gbp: 34.9, stock: 90, spec: "JASO MA2 (fits all four-stroke bikes in catalogue)" },
  { sku: "HM-CL-0505", title: "Clutch plate kit", category: "Engine", gbp: 62, fits: ["S", "K"], stock: 0, spec: "8 friction plates" },
  { sku: "HM-SP-0541", title: "Rear sprocket, 42T, 520 pitch", category: "Drivetrain", gbp: 31.5, fits: ["H1"], position: "rear", stock: 17, spec: "42T, 520, steel" },
  { sku: "HM-SP-0542", title: "Rear sprocket, 42T, 520 pitch (2016 on)", category: "Drivetrain", gbp: 31.5, fits: ["H2", "H3"], position: "rear", stock: 20, spec: "42T, 520, steel, offset for 2016 on" },
  { sku: "HM-SP-0440", title: "Front sprocket, 15T, 520 pitch", category: "Drivetrain", gbp: 12.9, fits: CB, position: "front", stock: 33, spec: "15T, 520" },
  { sku: "HM-CH-0520", title: "O-ring chain, 520 x 114", category: "Drivetrain", gbp: 59, fits: ["H1", "H2", "H3", "Y1", "Y2", "K", "S"], stock: 25, spec: "520, 114 links" },
  { sku: "HM-CH-0525", title: "X-ring chain, 525 x 120", category: "Drivetrain", gbp: 74, fits: ["T", "D"], stock: 11, spec: "525, 120 links" },
  { sku: "HM-AF-0001", title: "Air filter", category: "Filters", gbp: 19.8, fits: CB, stock: 52, spec: "Paper element" },
  { sku: "HM-AF-0077", title: "Air filter (MT-07)", category: "Filters", gbp: 21.4, fits: ["Y1", "Y2"], stock: 28, spec: "Paper element" },
  { sku: "HM-TY-0160", title: "Rear tyre, 160/60 ZR17", category: "Tyres", gbp: 94, fits: ["K", "S", "T"], position: "rear", stock: 8, spec: "160/60 ZR17" },
  { sku: "HM-TY-0120", title: "Front tyre, 120/70 ZR17", category: "Tyres", gbp: 82, fits: ["K", "S", "T"], position: "front", stock: 14, spec: "120/70 ZR17" },
  { sku: "HM-BT-0012", title: "Battery, 12 V 8 Ah", category: "Electrics", gbp: 54, fits: ["H1", "H2", "H3", "Y1"], stock: 19, spec: "12 V 8 Ah, sealed" },
  { sku: "HM-RG-0008", title: "Regulator rectifier", category: "Electrics", gbp: 68, fits: ["H1", "H2"], stock: 5, spec: "3-phase" },
  // Sengaja tanpa data fitment: harus tampil sebagai "Check fitment".
  { sku: "HM-LV-0044", title: "Folding brake lever", category: "Brakes", gbp: 27, stock: 40, spec: "CNC aluminium" },
];

// Konversi demo dari GBP. Harga dibulatkan ke .X0 / .X5 supaya terlihat wajar.
const RATE = { gbp: 1, usd: 1.27, eur: 1.17, aud: 1.95 } as const;
export function priceFor(gbp: number, currency: keyof typeof RATE): number {
  const v = gbp * RATE[currency];
  return currency === "gbp" ? gbp : Math.round(v * 20) / 20;
}
