import { categoryPath } from "./category-themes.ts";
import { normalize } from "./planning.ts";
export interface CategoryRedirect {
  from: string[];
  to_category_id: string;
}
/** Owner-approved historical paths follow their category after merges and moves. */
export function resolveCategoryPath(
  categories: { id: string; parent_id: string | null; name: string }[],
  redirects: CategoryRedirect[],
  input: string[],
) {
  const key = (p: string[]) => p.map(normalize).join("/");
  const match = [...redirects]
    .sort((a, b) => b.from.length - a.from.length)
    .find(
      (r) =>
        r.from.length <= input.length &&
        key(r.from) === key(input.slice(0, r.from.length)) &&
        categories.some((c) => c.id === r.to_category_id),
    );
  return match
    ? [
        ...categoryPath(categories, match.to_category_id),
        ...input.slice(match.from.length),
      ]
    : input.map((s) => s.trim());
}
