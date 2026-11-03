import { model } from "@medusajs/framework/utils";

// Pasangan (SKU, generasi motor). Tidak ada baris untuk SKU = fitment tidak diketahui.
const PartFitment = model
  .define("part_fitment", {
    id: model.id({ prefix: "fit" }).primaryKey(),
    sku: model.text(),
    bike_model_id: model.text(),
    position: model.enum(["front", "rear", "na"]).default("na"),
    note: model.text().nullable(),
  })
  .indexes([
    { on: ["sku", "bike_model_id"], unique: true },
    { on: ["bike_model_id"] },
  ]);

export default PartFitment;
