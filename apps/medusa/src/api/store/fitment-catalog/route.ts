import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { FITMENT_MODULE } from "../../../modules/fitment";
import type FitmentModuleService from "../../../modules/fitment/service";

// GET /store/fitment-catalog -> { parts: { "<sku>": [ { make, model, year_from, year_to } ] } }
// Dipakai hub untuk membangun pengetahuan asisten per SKU. Tanpa harga atau stok.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const fitment: FitmentModuleService = req.scope.resolve(FITMENT_MODULE);
  const [bikes, rows] = await Promise.all([fitment.listBikeModels({}), fitment.listPartFitments({})]);
  const byId = new Map(bikes.map((b) => [b.id, b]));
  const parts: Record<string, { make: string; model: string; year_from: number; year_to: number }[]> = {};
  for (const r of rows) {
    const b = byId.get(r.bike_model_id);
    if (b) (parts[r.sku] ??= []).push({ make: b.make, model: b.model, year_from: b.year_from, year_to: b.year_to });
  }
  res.json({ parts });
}
