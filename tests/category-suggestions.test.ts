import test from "node:test";
import assert from "node:assert/strict";
import { emptyRecipe } from "../shared/model.ts";
import { ingredient } from "./fixture.ts";
import { suggestCategoryPaths } from "../shared/category-suggestions.ts";
import { categoryTheme } from "../shared/category-themes.ts";
test("classification checks ingredients and preparation and distinguishes no-bake cheesecake", () => {
  const c = {
    ...emptyRecipe(),
    title: "עוגת גבינה ללא אפייה",
    ingredients: [ingredient("גבינה לבנה", "500", "גרם")],
  };
  assert.deepEqual(suggestCategoryPaths(c), [
    ["קינוחים", "עוגות גבינה ללא אפייה"],
  ]);
  assert.deepEqual(
    suggestCategoryPaths({ ...emptyRecipe(), title: "עוגת שוקולד" }),
    [],
  );
  assert.deepEqual(
    suggestCategoryPaths({
      ...c,
      title: "עוף",
      ingredients: [ingredient("חזה עוף", "500", "גרם")],
    }),
    [["בישול", "עוף"]],
  );
  assert.equal(
    categoryTheme(["אפייה", "עוגות", "עוגות גבינה אפויות"]).tile,
    10,
  );
  assert.equal(categoryTheme(["בישול", "מנות כבד"]).tile, 14);
  assert.equal(categoryTheme(["בישול", "ממרחים"]).pack, "extra");
});
