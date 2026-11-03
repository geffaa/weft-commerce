import { Module } from "@medusajs/framework/utils";
import FitmentModuleService from "./service";

export const FITMENT_MODULE = "fitment";

export default Module(FITMENT_MODULE, { service: FitmentModuleService });
