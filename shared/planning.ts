import type { Amount, Ingredient, RecipeContent } from "./model.ts";
import { convertMeasurement, type MeasurementConfig } from "./measurements.ts";
import {
  add,
  canonicalUnit,
  formatNumber,
  parseNumber,
  scaleRecipe,
  selectedIngredient,
} from "./quantities.ts";
export { selectedIngredient } from "./quantities.ts";
export const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/["״׳']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("he");
export interface ShoppingLine {
  name: string;
  unit: string;
  amount: Amount;
  source_refs: { recipe_id: string; ingredient_id: string; target: string }[];
  department: string;
  assumptions: string[];
}
export function shoppingForRecipes(
  items: {
    recipe_id: string;
    content: RecipeContent;
    target: string;
    measurement_config?: MeasurementConfig;
  }[],
  preferences?: MeasurementConfig,
): ShoppingLine[] {
  const result: ShoppingLine[] = [];
  for (const item of items) {
    const scaled = item.target
      ? scaleRecipe(item.content, item.target)
      : item.content;
    for (const original of scaled.ingredients) {
      const i = selectedIngredient(original),
        canonical = convertMeasurement(
          i.name,
          i.amount,
          i.unit,
          item.measurement_config,
          preferences,
        );
      const name = i.name + (i.egg_size ? ` בגודל ${i.egg_size}` : "");
      const ref = {
        recipe_id: item.recipe_id,
        ingredient_id: i.id,
        target: item.target,
      };
      const match = result.find(
        (r) =>
          normalize(r.name) === normalize(name) &&
          r.unit === canonical.unit &&
          r.amount.kind === "exact" &&
          canonical.amount.kind === "exact",
      );
      if (match) {
        match.amount = {
          ...match.amount,
          low: formatNumber(
            add(
              parseNumber(match.amount.low!),
              parseNumber(canonical.amount.low!),
            ),
          ),
        };
        match.source_refs.push(ref);
        if (
          canonical.assumption &&
          !match.assumptions.includes(canonical.assumption)
        )
          match.assumptions.push(canonical.assumption);
      } else
        result.push({
          name,
          unit: canonical.unit,
          amount: canonical.amount,
          source_refs: [ref],
          department: "כללי",
          assumptions: canonical.assumption ? [canonical.assumption] : [],
        });
    }
  }
  return result;
}
export function pantryMatches(
  recipes: { id: string; content: RecipeContent }[],
  pantry: {
    name: string;
    amount: Amount | null;
    unit: string | null;
    staple: boolean;
    use_soon: boolean;
  }[],
) {
  return recipes
    .map((r) => {
      const missing: string[] = [],
        unknownQuantity: string[] = [],
        soon: string[] = [];
      for (const raw of r.content.ingredients) {
        const i = selectedIngredient(raw);
        const p = pantry.find((p) => normalize(p.name) === normalize(i.name));
        if (!p) {
          missing.push(i.name);
          continue;
        }
        if (p.use_soon) soon.push(i.name);
        if (!p.amount || !p.unit) {
          unknownQuantity.push(i.name);
          continue;
        }
        const a = canonicalUnit(i.amount, i.unit),
          b = canonicalUnit(p.amount, p.unit);
        if (
          a.unit !== b.unit ||
          a.amount.kind !== "exact" ||
          b.amount.kind !== "exact"
        ) {
          unknownQuantity.push(i.name);
          continue;
        }
        const need = parseNumber(a.amount.low!),
          have = parseNumber(b.amount.low!);
        if (need.n * have.d > have.n * need.d) missing.push(i.name);
      }
      return {
        id: r.id,
        title: r.content.title,
        missing,
        unknown_quantity: unknownQuantity,
        use_soon: soon,
        group:
          missing.length === 0
            ? "available"
            : missing.length === 1
              ? "one_missing"
              : "several_missing",
      };
    })
    .sort(
      (a, b) =>
        a.missing.length - b.missing.length ||
        b.use_soon.length - a.use_soon.length,
    );
}
export function preparationPlan(
  items: {
    id: string;
    recipe_id?: string;
    content: RecipeContent;
    target: string;
  }[],
  equipment: Record<string, number>,
  anchor: string,
  anchorType: "start" | "serve",
) {
  const tasks: any[] = [],
    warnings: string[] = [],
    missing: string[] = [];
  const available: Record<string, number[]> = {};
  for (const [k, n] of Object.entries(equipment))
    available[k] = Array(Math.max(1, n)).fill(0);
  const finish = new Map<string, number>();
  const pending = items.flatMap((item) =>
    (item.target
      ? scaleRecipe(item.content, item.target)
      : item.content
    ).steps.map((s) => ({
      item,
      step: s,
      key: `${item.id}:${s.id}`,
    })),
  );
  let lastByRecipe = new Map<string, string>();
  while (pending.length) {
    const index = pending.findIndex(({ item, step }) =>
      step.depends_on.every((id) => finish.has(`${item.id}:${id}`)),
    );
    if (index < 0) {
      warnings.push("יש תלות חסרה או מעגל בין השלבים; נדרש תיקון ידני");
      break;
    }
    const { item, step, key } = pending.splice(index, 1)[0];
    const previous = lastByRecipe.get(item.id);
    const deps = step.depends_on.length
      ? step.depends_on.map((d) => `${item.id}:${d}`)
      : previous
        ? [previous]
        : [];
    let start = Math.max(0, ...deps.map((id) => finish.get(id) ?? 0));
    for (const e of step.equipment) {
      const slots = available[e] ?? (available[e] = [0]);
      start = Math.max(start, Math.min(...slots));
    }
    const duration = step.duration_minutes ?? 0;
    if (step.duration_minutes === null)
      missing.push(`${item.content.title}: שלב ${step.id}`);
    const end = start + duration;
    for (const e of step.equipment) {
      const slots = available[e];
      slots[slots.indexOf(Math.min(...slots))] = end;
    }
    finish.set(key, end);
    lastByRecipe.set(item.id, key);
    tasks.push({
      id: key,
      recipe_id: item.recipe_id ?? item.id,
      step_id: step.id,
      title: item.content.title,
      text: step.text,
      start_minutes: start,
      end_minutes: end,
      temperature_c: step.temperature_c,
      equipment: step.equipment,
      depends_on: deps,
      time_origin: step.duration_minutes === null ? "unknown" : "recipe",
    });
  }
  const total = Math.max(0, ...tasks.map((t) => t.end_minutes));
  const origin =
    new Date(anchor).getTime() - (anchorType === "serve" ? total * 60000 : 0);
  for (const t of tasks) {
    t.start_at = new Date(origin + t.start_minutes * 60000).toISOString();
    t.end_at = new Date(origin + t.end_minutes * 60000).toISOString();
  }
  if (missing.length)
    warnings.push("זמנים חסרים לא הומצאו. סדר העבודה משוער בלבד");
  if (tasks.some((t) => t.equipment.some((e: string) => !(e in equipment))))
    warnings.push("קיבולת ציוד שלא הוגדרה הונחה כיחידה אחת; יש לבדוק");
  return {
    tasks,
    warnings,
    missing,
    total_minutes: missing.length ? null : total,
    anchor,
    anchor_type: anchorType,
    equipment,
    assumptions: [
      "כל פריט תופס יחידת ציוד אחת; אין הנחה ששתי תבניות נכנסות יחד",
      "זמני המתנה ינוצלו רק אם הוגדרו כשלבים נפרדים ללא תפיסת ציוד",
    ],
  };
}
