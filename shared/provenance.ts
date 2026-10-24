import type { RecipeContent } from "./model.ts";
export type FieldSources = Record<
  string,
  "source" | "manual" | "default" | "ai"
>;
function fields(content: RecipeContent) {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(content)) {
    if (k === "ingredients" || k === "steps") {
      for (const entry of v as any[])
        for (const [key, value] of Object.entries(entry))
          if (key !== "id") result[`${k}.${entry.id}.${key}`] = value;
    } else result[k] = v;
  }
  return result;
}
export function fieldSources(
  content: RecipeContent,
  origin: "source" | "manual",
  previous?: RecipeContent,
  existing: FieldSources = {},
): FieldSources {
  const output = { ...existing },
    before = previous ? fields(previous) : {};
  for (const [path, value] of Object.entries(fields(content))) {
    if (origin === "source" && (value === null || value === "")) continue;
    if (JSON.stringify(before[path]) !== JSON.stringify(value) || !output[path])
      output[path] = origin;
  }
  for (const i of content.ingredients)
    if (i.egg_size_origin === "default")
      output[`ingredients.${i.id}.egg_size`] = "default";
  if (content.difficulty_origin === "ai") output.difficulty = "ai";
  return output;
}
export const sourceLabel = (value: string | undefined) =>
  (
    ({
      source: "נקרא במקור",
      manual: "הזנה או תיקון ידני",
      default: "ברירת מחדל מפורשת",
      ai: "הצעת AI",
    }) as Record<string, string>
  )[value ?? ""] ?? "מקור המידע לא תועד";
