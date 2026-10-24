import type { RecipeContent } from "./model.ts";
import { parseNumber, formatNumber } from "./quantities.ts";
import { normalize } from "./planning.ts";
const number = (value: string | null) => {
  if (value === null) return null;
  try {
    return formatNumber(parseNumber(value));
  } catch {
    return value.trim();
  }
};
export function evaluateExtraction(
  expected: RecipeContent,
  actual: RecipeContent,
) {
  const rows = expected.ingredients.map((e, index) => {
    const a =
      actual.ingredients.find(
        (a) => normalize(a.name) === normalize(e.name) && a.group === e.group,
      ) ?? actual.ingredients[index];
    return {
      ingredient: e.name,
      name_correct: !!a && normalize(a.name) === normalize(e.name),
      quantity_correct:
        !!a &&
        e.amount.kind === a.amount.kind &&
        number(e.amount.low) === number(a.amount.low) &&
        number(e.amount.high) === number(a.amount.high) &&
        (e.amount.kind !== "text" ||
          e.amount.text.trim() === a.amount.text.trim()),
      unit_correct: !!a && normalize(e.unit) === normalize(a.unit),
      original_preserved: !!a && e.original.trim() === a.original.trim(),
      alternatives_correct:
        !!a &&
        e.alternatives.length === a.alternatives.length &&
        e.alternatives.every(
          (v, i) =>
            normalize(v.name) === normalize(a.alternatives[i]?.name ?? ""),
        ),
      egg_size_correct: !!a && e.egg_size === a.egg_size,
    };
  });
  const links = (r: RecipeContent) =>
    r.steps.map((s) =>
      s.links.map((l) => ({
        ingredient:
          r.ingredients.find((i) => i.id === l.ingredient_id)?.name ??
          "missing",
        portion: number(l.portion),
        placeholder: l.placeholder,
      })),
    );
  return {
    requires_human_source_review: true,
    ingredients: rows,
    critical_quantity_unit_errors: rows.filter(
      (r) => !r.quantity_correct || !r.unit_correct,
    ).length,
    yield_correct:
      expected.yield === null
        ? actual.yield === null
        : !!actual.yield &&
          number(expected.yield.amount) === number(actual.yield.amount) &&
          normalize(expected.yield.unit) === normalize(actual.yield.unit),
    instruction_links_correct:
      JSON.stringify(links(expected)) === JSON.stringify(links(actual)),
    active_time_correct: expected.active_minutes === actual.active_minutes,
    total_time_correct: expected.total_minutes === actual.total_minutes,
    note: "מדדים מול תמלול ידני אינם מחליפים בדיקת תמונת מקור. התאמה בשם בלבד אינה הצלחת חילוץ.",
  };
}
