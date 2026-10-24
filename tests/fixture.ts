import {
  emptyRecipe,
  type RecipeContent,
  type Ingredient,
} from "../shared/model.ts";
import { parseAmount } from "../shared/quantities.ts";
export function ingredient(
  name: string,
  amount: string,
  unit = "",
): Ingredient {
  return {
    id: crypto.randomUUID(),
    group: "",
    original: `${amount} ${unit} ${name}`,
    name,
    amount: parseAmount(amount),
    unit,
    note: "",
    alternatives: [],
    selected_alternative: null,
    egg_size: null,
    egg_size_origin: null,
    provenance: "manual",
    uncertainty: null,
  };
}
export function recipe(): RecipeContent {
  const content: RecipeContent = {
    ...emptyRecipe(),
    title: "לחם המטבח — נתוני בדיקה מסומנים",
    yield: { amount: "5", unit: "מנות", pan: null },
    ingredients: [
      ingredient("קמח", "2", "ק״ג"),
      ingredient("סוכר", "1", "ק״ג"),
      ingredient("מים", "1", "ליטר"),
    ],
    steps: [
      {
        id: "knead",
        group: "",
        text: "ללוש עם {{קמח}}. לחמם ל־180 מעלות ולאפות 30 דקות.",
        duration_minutes: 30,
        temperature_c: 180,
        equipment: ["תנור"],
        depends_on: [],
        links: [{ placeholder: "{{קמח}}", ingredient_id: "", portion: "1" }],
      },
    ],
    active_minutes: 10,
    total_minutes: 150,
    classification: "פרווה",
    raw_text: "נתוני בדיקה סינתטיים — לא ייבוא של משתמש",
    tags: ["ללא מיקסר"],
  };
  content.steps[0].links[0].ingredient_id = content.ingredients[0].id;
  return content;
}
