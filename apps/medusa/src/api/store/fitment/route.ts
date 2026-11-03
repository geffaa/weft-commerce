import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { FITMENT_MODULE } from "../../../modules/fitment";
import type FitmentModuleService from "../../../modules/fitment/service";

// GET /store/fitment?bike_model_id=bike_...&skus=HM-BP-0196,HM-SP-0541
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { bike_model_id, skus } = req.query as Record<string, string | undefined>;
  const list = (skus ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!bike_model_id || !list.length || list.length > 100) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "bike_model_id and 1-100 comma-separated skus are required",
    );
  }
  const fitment: FitmentModuleService = req.scope.resolve(FITMENT_MODULE);
  res.json({ bike_model_id, status: await fitment.statusFor(bike_model_id, list) });
}
