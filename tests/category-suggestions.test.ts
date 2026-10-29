import test from "node:test";
import assert from "node:assert/strict";
import { emptyRecipe } from "../shared/model.ts";
import { ingredient } from "./fixture.ts";
import { suggestCategoryPaths } from "../shared/category-suggestions.ts";
import { categoryTheme } from "../shared/category-themes.ts";
import { resolveCategoryPath } from "../shared/category-paths.ts";
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
test("approved historical category paths follow merged branches and preserve a new child without creating a duplicate parent", () => {
  const categories = [
    { id: "a", name: "אפייה", parent_id: null },
    { id: "b", name: "מאפים מלוחים", parent_id: "a" },
    { id: "p", name: "פיצות", parent_id: "b" },
  ];
  const redirects = [{ from: ["אפייה", "פיצה"], to_category_id: "p" }];
  assert.deepEqual(
    resolveCategoryPath(categories, redirects, ["אפייה", "פיצה"]),
    ["אפייה", "מאפים מלוחים", "פיצות"],
  );
  assert.deepEqual(
    resolveCategoryPath(categories, redirects, ["אפייה", "פיצה", "ללא גלוטן"]),
    ["אפייה", "מאפים מלוחים", "פיצות", "ללא גלוטן"],
  );
  assert.deepEqual(
    resolveCategoryPath(
      categories,
      [{ from: ["ישן"], to_category_id: "missing" }],
      ["ישן"],
    ),
    ["ישן"],
  );
});
