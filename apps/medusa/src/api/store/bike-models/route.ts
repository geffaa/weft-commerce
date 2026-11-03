import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { FITMENT_MODULE } from "../../../modules/fitment";
import type FitmentModuleService from "../../../modules/fitment/service";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const fitment: FitmentModuleService = req.scope.resolve(FITMENT_MODULE);
  const bike_models = await fitment.listBikeModels(
    {},
    { order: { make: "ASC", model: "ASC", year_from: "DESC" } },
  );
  res.json({ bike_models });
}
