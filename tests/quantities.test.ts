import test from "node:test";
import assert from "node:assert/strict";
import { recipe, ingredient } from "./fixture.ts";
import {
  applyEggDefault,
  amountText,
  formatNumber,
  parseNumber,
  parseAmount,
  readiness,
  scaleRecipe,
  selectedIngredient,
} from "../shared/quantities.ts";
import {
  shoppingForRecipes,
  preparationPlan,
  pantryMatches,
} from "../shared/planning.ts";
test("5 to 8 and back always computes from exact base values; step constants remain unchanged", () => {
  const base = recipe();
  base.steps[0].links[0].ingredient_id = base.ingredients[0].id;
  const scaled = scaleRecipe(base, "8");
  assert.deepEqual(
    scaled.ingredients.map((i) => i.amount.low),
    ["3.2", "1.6", "1.6"],
  );
  assert.equal(scaled.steps[0].temperature_c, 180);
  assert.equal(scaled.steps[0].duration_minutes, 30);
  assert.match(scaled.steps[0].text, /3.2 ק״ג/);
  assert.match(scaled.steps[0].text, /180.*30/);
  assert.deepEqual(
    scaleRecipe(base, "5").ingredients.map((i) => i.amount.low),
    ["2", "1", "1"],
  );
  assert.equal(base.ingredients[0].amount.low, "2");
});
test("fractions, mixed numbers, ranges and missing amounts preserve information", () => {
  assert.equal(formatNumber(parseNumber("½")), "0.5");
  assert.equal(formatNumber(parseNumber("1½")), "1.5");
  assert.equal(formatNumber(parseNumber("1 1/3")), "4/3");
  const c = recipe();
  c.ingredients = [
    ingredient("ביצים", "1"),
    ingredient("מלח", "לפי הטעם"),
    ingredient("שום", "2–3"),
    ingredient("כמות לא קריאה", ""),
  ];
  const scaled = scaleRecipe(c, "8");
  assert.equal(amountText(scaled.ingredients[0].amount), "1.6");
  assert.equal(amountText(scaled.ingredients[1].amount), "לפי הטעם");
  assert.equal(amountText(scaled.ingredients[2].amount), "3.2–4.8");
  assert.equal(scaled.ingredients[3].amount.kind, "missing");
  assert.throws(() => scaleRecipe(c, "0"));
  assert.throws(() => scaleRecipe({ ...c, yield: null }, "8"));
});
test("whole eggs default only to M; explicit sizes, gram quantities, whites and yolks stay untouched", () => {
  assert.equal(applyEggDefault(ingredient("ביצים", "3")).egg_size, "M");
  assert.equal(
    applyEggDefault({
      ...ingredient("ביצים", "3"),
      egg_size: "L",
      egg_size_origin: "manual",
    }).egg_size,
    "L",
  );
  for (const i of [
    ingredient("ביצים", ""),
    ingredient("ביצים", "100", "גרם"),
    ingredient("חלבונים", "3"),
    ingredient("חלמונים", "2"),
  ])
    assert.equal(applyEggDefault(i).egg_size, null);
});
test("shopping respects alternatives and unit compatibility and retains recipe source references", () => {
  const a = recipe(),
    b = recipe();
  a.ingredients = [
    ingredient("קמח", "1", "ק״ג"),
    ingredient("חמאה", "100", "גרם"),
    ingredient("קמח", "1", "כוס"),
  ];
  a.ingredients[1].alternatives = [
    { name: "מרגרינה", amount: parseAmount("100"), unit: "גרם" },
  ];
  a.ingredients[1].selected_alternative = 0;
  b.ingredients = [ingredient("קמח", "500", "גרם")];
  const lines = shoppingForRecipes([
    { recipe_id: "a", content: a, target: "5" },
    { recipe_id: "b", content: b, target: "5" },
  ]);
  const flour = lines.find((l) => l.name === "קמח" && l.unit === "גרם")!;
  assert.equal(flour.amount.low, "1500");
  assert.equal(flour.source_refs.length, 2);
  assert.ok(lines.some((l) => l.name === "קמח" && l.unit === "כוס"));
  assert.ok(lines.some((l) => l.name === "מרגרינה"));
  assert.ok(!lines.some((l) => l.name === "חמאה"));
});
test("explicit main or alternative choice updates linked quantities and does not attach an egg size to a substitute", () => {
  const c = recipe();
  const eggs = applyEggDefault(ingredient("ביצים", "3"));
  eggs.alternatives = [
    { name: "מחית תפוחים", amount: parseAmount("120"), unit: "גרם" },
  ];
  eggs.selected_alternative = 0;
  c.ingredients = [eggs];
  c.steps[0].text = "להוסיף {{כמות}}. לאפות 30 דקות ב־180 מעלות";
  c.steps[0].links = [
    { placeholder: "{{כמות}}", ingredient_id: eggs.id, portion: "1/2" },
  ];
  const scaled = scaleRecipe(c, "8");
  assert.match(scaled.steps[0].text, /96 גרם/);
  assert.equal(selectedIngredient(scaled.ingredients[0]).egg_size, null);
  eggs.selected_alternative = -1;
  assert.equal(readiness(c).length, 0);
  assert.equal(selectedIngredient(eggs).egg_size, "M");
  eggs.selected_alternative = 0;
  eggs.alternatives[0].amount = parseAmount("");
  assert.match(readiness(c).join(" "), /החלופה הנבחרת/);
});
test("readiness rejects missing yield, uncertain quantities and cyclic dependencies", () => {
  assert.ok(readiness({ ...recipe(), yield: null }).length);
  const r = recipe();
  r.steps[0].depends_on = [r.steps[0].id];
  assert.match(readiness(r).join(" "), /תלויות/);
  r.ingredients[0].uncertainty = "המספר אינו קריא";
  assert.match(readiness(r).join(" "), /בדיקה/);
});
test("preparation schedules one oven without assuming simultaneous pans and exposes missing durations", () => {
  const a = recipe(),
    b = recipe();
  const p = preparationPlan(
    [
      { id: "a", content: a, target: "5" },
      { id: "b", content: b, target: "5" },
    ],
    { תנור: 1 },
    "2026-10-24T10:00:00Z",
    "start",
  );
  assert.equal(p.tasks[1].start_minutes, 30);
  assert.equal(p.total_minutes, 60);
  b.steps[0].duration_minutes = null;
  const unknown = preparationPlan(
    [{ id: "b", content: b, target: "5" }],
    { תנור: 1 },
    "2026-10-24T10:00:00Z",
    "serve",
  );
  assert.equal(unknown.total_minutes, null);
  assert.equal(unknown.missing.length, 1);
});
test("pantry matching does not invent enough quantity when only presence is known", () => {
  const c = recipe();
  c.ingredients = [ingredient("קמח", "2", "ק״ג")];
  const r = pantryMatches(
    [{ id: "r", content: c }],
    [{ name: "קמח", amount: null, unit: null, staple: false, use_soon: true }],
  )[0];
  assert.equal(r.missing.length, 0);
  assert.deepEqual(r.unknown_quantity, ["קמח"]);
  assert.deepEqual(r.use_soon, ["קמח"]);
});

import { convertMeasurement } from "../shared/measurements.ts";
test("cup and package conversions require explicit scoped definitions and never equate cups with grams", () => {
  const amount = parseAmount("2");
  assert.equal(convertMeasurement("קמח", amount, "כוס").unit, "כוס");
  const cup = convertMeasurement(
    "קמח",
    amount,
    "כוס",
    { cup_ml: 240, packages: [] },
    { cup_ml: 200, packages: [] },
  );
  assert.equal(cup.unit, "מ״ל");
  assert.equal(cup.amount.low, "480");
  const pack = convertMeasurement(
    "חמאה",
    amount,
    "חבילה",
    { cup_ml: null, packages: [{ ingredient: "חמאה", grams: "250" }] },
    { cup_ml: null, packages: [{ ingredient: "חמאה", grams: "200" }] },
  );
  assert.equal(pack.amount.low, "500");
  assert.equal(
    convertMeasurement("קמח", amount, "חבילה", {
      cup_ml: null,
      packages: [{ ingredient: "חמאה", grams: "250" }],
    }).unit,
    "חבילה",
  );
});
import { evaluateExtraction } from "../shared/evaluation.ts";
test("Hebrew extraction evaluation fails a quantity or unit mistake even when names are correct", () => {
  const expected = recipe(),
    actual = structuredClone(expected);
  actual.ingredients[0].amount.low = "3";
  actual.ingredients[1].unit = "כוס";
  const result = evaluateExtraction(expected, actual);
  assert.equal(result.critical_quantity_unit_errors, 2);
  assert.equal(result.ingredients[0].name_correct, true);
  assert.equal(result.requires_human_source_review, true);
});
