import type { Amount } from "./model.ts";
import { canonicalUnit, scaleAmount, parseNumber } from "./quantities.ts";
export interface MeasurementConfig {
  cup_ml: number | null;
  packages: { ingredient: string; grams: string }[];
}
export const measurementDefaults: MeasurementConfig = {
  cup_ml: null,
  packages: [],
};
export function convertMeasurement(
  name: string,
  amount: Amount,
  unit: string,
  recipeConfig?: MeasurementConfig,
  preferenceConfig?: MeasurementConfig,
) {
  if (["כוס", "כוסות"].includes(unit)) {
    const ml = recipeConfig?.cup_ml ?? preferenceConfig?.cup_ml;
    if (ml)
      return {
        amount: scaleAmount(amount, parseNumber(String(ml))),
        unit: "מ״ל",
        assumption: `כוס של ${ml} מ״ל (${recipeConfig?.cup_ml ? "הגדרת המתכון" : "העדפה אישית"})`,
      };
  }
  if (["חבילה", "חבילות", "אריזה", "אריזות"].includes(unit)) {
    const specific = recipeConfig?.packages.find(
        (p) => p.ingredient.trim() === name.trim(),
      ),
      general = preferenceConfig?.packages.find(
        (p) => p.ingredient.trim() === name.trim(),
      ),
      p = specific ?? general;
    if (p)
      return {
        amount: scaleAmount(amount, parseNumber(p.grams)),
        unit: "גרם",
        assumption: `אריזה של ${p.grams} גרם (${specific ? "הגדרת המתכון" : "העדפה אישית"})`,
      };
  }
  return { ...canonicalUnit(amount, unit), assumption: null };
}
