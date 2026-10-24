import { z } from "zod";
export const AmountSchema = z
  .object({
    kind: z.enum(["exact", "range", "text", "missing"]),
    low: z.string().nullable(),
    high: z.string().nullable(),
    text: z.string(),
  })
  .strict();
export const IngredientSchema = z
  .object({
    id: z.string(),
    group: z.string(),
    original: z.string(),
    name: z.string(),
    amount: AmountSchema,
    unit: z.string(),
    note: z.string(),
    alternatives: z.array(
      z
        .object({ name: z.string(), unit: z.string(), amount: AmountSchema })
        .strict(),
    ),
    // null = not confirmed; -1 = explicitly use the main ingredient; >=0 = alternative index.
    selected_alternative: z.number().int().nullable(),
    egg_size: z.enum(["S", "M", "L", "XL"]).nullable(),
    egg_size_origin: z.enum(["source", "manual", "default"]).nullable(),
    provenance: z.enum(["source", "manual", "ai"]),
    uncertainty: z.string().nullable(),
  })
  .strict();
export const StepSchema = z
  .object({
    id: z.string(),
    group: z.string(),
    text: z.string(),
    duration_minutes: z.number().nonnegative().nullable(),
    temperature_c: z.number().nullable(),
    equipment: z.array(z.string()),
    depends_on: z.array(z.string()),
    links: z.array(
      z
        .object({
          placeholder: z.string(),
          ingredient_id: z.string(),
          portion: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export const RecipeContentSchema = z
  .object({
    title: z.string().max(200),
    description: z.string().max(10000),
    yield: z
      .object({
        amount: z.string(),
        unit: z.string(),
        pan: z.string().nullable(),
      })
      .strict()
      .nullable(),
    ingredients: z.array(IngredientSchema).max(300),
    steps: z.array(StepSchema).max(300),
    equipment: z.array(z.string()),
    active_minutes: z.number().nonnegative().nullable(),
    total_minutes: z.number().nonnegative().nullable(),
    classification: z.enum(["בשרי", "חלבי", "פרווה", "לא ידוע"]),
    tags: z.array(z.string()),
    difficulty: z.enum(["קל", "בינוני", "מורכב", "לא ידוע"]),
    difficulty_origin: z.enum(["manual", "ai", "unknown"]),
    source_name: z.string(),
    story: z.string(),
    notes: z.string(),
    raw_text: z.string(),
    uncertainties: z.array(
      z.object({ path: z.string(), reason: z.string() }).strict(),
    ),
    split_suggestion: z.string().nullable(),
  })
  .strict();
export type Amount = z.infer<typeof AmountSchema>;
export type Ingredient = z.infer<typeof IngredientSchema>;
export type RecipeContent = z.infer<typeof RecipeContentSchema>;
export type RecipeStep = z.infer<typeof StepSchema>;
export interface RecipeRecord {
  id: string;
  revision: number;
  status: "draft" | "published" | "trash";
  content: RecipeContent;
  favorite: boolean;
  category_ids: string[];
  created_at: string;
  updated_at: string;
  last_cooked_at: string | null;
  cook_count: number;
  rating: number | null;
  primary_media_id: string | null;
}
export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  aliases: string[];
  media_id: string | null;
  image_state: string;
  image_revision: number;
}
export interface Media {
  id: string;
  kind: string;
  origin: string;
  state: string;
  caption: string;
  derivatives: Record<string, string>;
  metadata: Record<string, unknown>;
}
export const emptyRecipe = (): RecipeContent => ({
  title: "",
  description: "",
  yield: null,
  ingredients: [],
  steps: [],
  equipment: [],
  active_minutes: null,
  total_minutes: null,
  classification: "לא ידוע",
  tags: [],
  difficulty: "לא ידוע",
  difficulty_origin: "unknown",
  source_name: "",
  story: "",
  notes: "",
  raw_text: "",
  uncertainties: [],
  split_suggestion: null,
});

export const MeasurementSchema = z
  .object({
    cup_ml: z.number().positive().max(1000).nullable(),
    packages: z
      .array(
        z
          .object({
            ingredient: z.string().min(1).max(200),
            grams: z.string().min(1).max(30),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
