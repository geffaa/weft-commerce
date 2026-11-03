import { MedusaService } from "@medusajs/framework/utils";
import BikeModel from "./models/bike-model";
import PartFitment from "./models/part-fitment";

export type FitStatus = "fits" | "no_fit" | "unknown";

class FitmentModuleService extends MedusaService({ BikeModel, PartFitment }) {
  /**
   * Status per SKU untuk satu motor. Tanpa baris fitment sama sekali untuk SKU,
   * jawabannya "unknown" (Check fitment), bukan "fits".
   */
  async statusFor(bikeModelId: string, skus: string[]): Promise<Record<string, FitStatus>> {
    const rows = await this.listPartFitments({ sku: skus });
    const known = new Set(rows.map((r) => r.sku));
    const fits = new Set(rows.filter((r) => r.bike_model_id === bikeModelId).map((r) => r.sku));
    return Object.fromEntries(
      skus.map((s) => [s, fits.has(s) ? "fits" : known.has(s) ? "no_fit" : "unknown"]),
    );
  }
}

export default FitmentModuleService;
