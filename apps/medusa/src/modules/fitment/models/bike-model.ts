import { model } from "@medusajs/framework/utils";

// Satu baris = satu generasi motor (merek, model, rentang tahun produksi).
const BikeModel = model
  .define("bike_model", {
    id: model.id({ prefix: "bike" }).primaryKey(),
    make: model.text(),
    model: model.text(),
    year_from: model.number(),
    year_to: model.number(),
    engine_cc: model.number(),
  })
  .indexes([{ on: ["make", "model", "year_from"], unique: true }]);

export default BikeModel;
