/** Generic AI illustrations bundled with the app; these are never personal cooking photos. */
export const categoryArtwork = {
  version: "kitchen-library-v1",
  creator: "ChatGPT image generation",
  model: "not reported by the image tool",
  prompt_version: "category-atlas-he-v1",
};
const themes = [
  [/בישול|מנות משולבות/u, "main", 0],
  [/אפייה|בצק/u, "main", 1],
  [/קינוח|מוס|כוסות|ללא אפייה/u, "main", 2],
  [/בשר|בקר|טלה|אוסובוקו/u, "main", 3],
  [/עוף|פרגית|שניצל|הודו/u, "main", 4],
  [/דג|סלמון|טונה/u, "main", 5],
  [/סלט|חסה|כרוב/u, "main", 6],
  [/מרק/u, "main", 7],
  [/עוגה|עוגות|שוקולד/u, "main", 8],
  [/עוגי[הת]|עוגיות/u, "main", 9],
  [/גבינה|גבינות/u, "main", 10],
  [/לחם|לחמים|חלה|חלות|לאפות|פיתה/u, "main", 11],
  [/אורז|תוספ/u, "main", 12],
  [/פסטה|פסטות|איטלקי/u, "main", 13],
  [/כבד|פטה/u, "main", 14],
  [/רוטב|רטבים/u, "main", 15],
  [/ממרח|חומוס|טחינה/u, "extra", 0],
  [/מאפינס|מאפין/u, "extra", 1],
  [/מלוח|בורקס|קיש/u, "extra", 2],
  [/טארט|פאי/u, "extra", 3],
] as const;
export function categoryTheme(path: string[]) {
  // Match the most specific branch first, then fall back to its ancestors.
  for (const name of [...path].reverse()) {
    // Specific overlapping names take precedence within a single category.
    const match = [...themes].reverse().find(([pattern]) => pattern.test(name));
    if (match) return themeInfo(match[1], match[2]);
  }
  return themeInfo("main", 0);
}
function themeInfo(pack: "main" | "extra", tile: number) {
  const columns = pack === "main" ? 4 : 2;
  return {
    pack,
    tile,
    columns,
    url: `/category-illustrations/${pack}.webp`,
    position: `${((tile % columns) / (columns - 1)) * 100}% ${(Math.floor(tile / columns) / (columns - 1)) * 100}%`,
    disclosure: "תמונת המחשה באמצעות AI",
  };
}
export function categoryPath(
  categories: { id: string; parent_id: string | null; name: string }[],
  id: string,
): string[] {
  const result: string[] = [],
    seen = new Set<string>();
  let current = categories.find((c) => c.id === id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current.name);
    current = categories.find((c) => c.id === current!.parent_id);
  }
  return result;
}
export const starterPaths = [
  ["בישול", "בשר"],
  ["בישול", "עוף"],
  ["בישול", "דגים"],
  ["בישול", "סלטים", "סלטי חסה"],
  ["בישול", "סלטים", "סלטי כרוב"],
  ["בישול", "תוספות"],
  ["בישול", "מרקים"],
  ["בישול", "פסטה"],
  ["בישול", "מנות אורז"],
  ["בישול", "ממרחים"],
  ["בישול", "מנות כבד"],
  ["בישול", "רטבים", "רטבים לסלט"],
  ["אפייה", "עוגות", "עוגות שוקולד"],
  ["אפייה", "עוגות", "עוגות גבינה אפויות"],
  ["אפייה", "עוגיות"],
  ["אפייה", "לחמים"],
  ["אפייה", "בצקים"],
  ["אפייה", "מאפינס"],
  ["אפייה", "מאפים מלוחים"],
  ["אפייה", "טארטים ופאי"],
  ["קינוחים", "קינוחים ללא אפייה"],
  ["קינוחים", "עוגות גבינה ללא אפייה"],
  ["קינוחים", "קינוחי כוסות"],
];
