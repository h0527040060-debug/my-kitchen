import type { RecipeContent } from "./model.ts";
/** Transparent offline suggestions, using ingredients and preparation as well as the name. */
export function suggestCategoryPaths(content: RecipeContent): string[][] {
  if (!content.ingredients.some((i) => i.name.trim())) return [];
  const title = content.title,
    ingredients = content.ingredients.map((i) => i.name).join(" "),
    steps = content.steps.map((s) => s.text).join(" "),
    text = title + " " + steps,
    oven = /תנור|לאפות|אופים|אפייה/.test(
      steps + " " + content.equipment.join(" "),
    ),
    noBake = /ללא אפייה|בלי אפייה|ללא תנור|בלי תנור/.test(text);
  if (/עוג.*גבינ/.test(title) && /גבינה|שמנת|מסקרפונה/.test(ingredients))
    return [
      oven && !noBake
        ? ["אפייה", "עוגות", "עוגות גבינה אפויות"]
        : noBake
          ? ["קינוחים", "עוגות גבינה ללא אפייה"]
          : ["קינוחים"],
    ];
  if (/כבד/.test(ingredients)) return [["בישול", "מנות כבד"]];
  if (/סלמון|אמנון|דג|טונה|בקלה|דניס/.test(ingredients))
    return [["בישול", "דגים"]];
  if (/עוף|פרגית|שוקיים|כרעיים|שניצל|הודו/.test(ingredients))
    return [["בישול", "עוף"]];
  if (/בשר|בקר|טלה|אוסובוקו|אסאדו/.test(ingredients)) return [["בישול", "בשר"]];
  if (/סלט/.test(title) && /חסה|כרוב|מלפפון|עגבני/.test(ingredients))
    return [
      [
        "בישול",
        "סלטים",
        ...(/כרוב/.test(ingredients)
          ? ["סלטי כרוב"]
          : /חסה/.test(ingredients)
            ? ["סלטי חסה"]
            : []),
      ],
    ];
  if (/מרק/.test(title) && /בישול|מבשלים|סיר/.test(steps))
    return [["בישול", "מרקים"]];
  if (/רוטב/.test(title))
    return [["בישול", "רטבים", ...(/סלט/.test(title) ? ["רטבים לסלט"] : [])]];
  if (/פסטה|ספגטי|מקרוני/.test(ingredients)) return [["בישול", "פסטה"]];
  if (/מאפינס/.test(title) && oven) return [["אפייה", "מאפינס"]];
  if (/עוגיות/.test(title) && (/קמח|שקדים/.test(ingredients) || oven))
    return [["אפייה", "עוגיות"]];
  if (/עוג[הת]|עוגות/.test(title) && oven && !noBake)
    return [
      [
        "אפייה",
        "עוגות",
        ...(/שוקולד|קקאו/.test(ingredients) ? ["עוגות שוקולד"] : []),
      ],
    ];
  if (noBake || /מוס|קינוח|מלבי/.test(title))
    return [["קינוחים", "קינוחים ללא אפייה"]];
  if (
    /קמח/.test(ingredients) &&
    /שמרים/.test(ingredients) &&
    /לישה|ללוש|לשים|בצק/.test(text)
  )
    return [["אפייה", /בצק/.test(title) ? "בצקים" : "לחמים"]];
  if (/אורז/.test(ingredients)) return [["בישול", "מנות אורז"]];
  if (/חומוס|טחינה/.test(ingredients) && /טחינה|טוחנים|מעבד/.test(steps))
    return [["בישול", "ממרחים"]];
  if (/תפוחי אדמה/.test(ingredients) && /אופ|בישול|מבשלים/.test(steps))
    return [["בישול", "תוספות"]];
  return [];
}
