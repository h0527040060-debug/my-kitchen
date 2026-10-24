import type { Amount, Ingredient, RecipeContent, RecipeStep } from "./model.ts";
export interface Rational {
  n: bigint;
  d: bigint;
}
const gcd = (a: bigint, b: bigint): bigint =>
  b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b);
export function rational(n: bigint, d = 1n): Rational {
  if (!d) throw Error("מכנה אפס אינו תקין");
  const g = gcd(n, d);
  return { n: (n / g) * (d < 0n ? -1n : 1n), d: (d < 0n ? -d : d) / g };
}
const unicode: Record<string, string> = {
  "½": "1/2",
  "¼": "1/4",
  "¾": "3/4",
  "⅓": "1/3",
  "⅔": "2/3",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};
export function parseNumber(raw: string): Rational {
  if (raw.length > 100) throw Error("הכמות ארוכה מדי");
  if (/,\d{3}(?:,|$)/.test(raw.trim()))
    throw Error("פסיק אלפים אינו חד משמעי; יש להזין מספר ללא הפרדת אלפים");
  let s = raw
    .trim()
    .replace(/,/g, ".")
    .replace(/^([+-]?)\./, "$10.");
  for (const [c, v] of Object.entries(unicode)) s = s.replace(c, ` ${v}`);
  s = s.trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const d = BigInt(mixed[3]);
    return rational(BigInt(mixed[1]) * d + BigInt(mixed[2]), d);
  }
  const fraction = s.match(/^([+-]?\d+)\/(\d+)$/);
  if (fraction) return rational(BigInt(fraction[1]), BigInt(fraction[2]));
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) throw Error("כמות מספרית אינה תקינה");
  const [whole, decimal = ""] = s.split(".");
  return rational(BigInt(whole + decimal), 10n ** BigInt(decimal.length));
}
export const multiply = (a: Rational, b: Rational) =>
  rational(a.n * b.n, a.d * b.d);
export const divide = (a: Rational, b: Rational) =>
  rational(a.n * b.d, a.d * b.n);
export const add = (a: Rational, b: Rational) =>
  rational(a.n * b.d + b.n * a.d, a.d * b.d);
export function formatNumber(a: Rational): string {
  if (a.d === 1n) return a.n.toString();
  let d = a.d;
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  if (d !== 1n) return `${a.n}/${a.d}`;
  let scale = 0,
    pow = 1n;
  while (pow % a.d !== 0n) {
    pow *= 10n;
    scale++;
  }
  const n = ((a.n * pow) / a.d).toString();
  const neg = n.startsWith("-");
  const digits = (neg ? n.slice(1) : n).padStart(scale + 1, "0");
  return (
    (neg ? "-" : "") +
    digits.slice(0, -scale) +
    "." +
    digits.slice(-scale).replace(/0+$/, "")
  );
}
export function parseAmount(raw: string): Amount {
  const s = raw.trim();
  if (!s) return { kind: "missing", low: null, high: null, text: raw };
  const range = s.match(/^(.+?)\s*[–−-]\s*(.+)$/);
  try {
    if (range) {
      const low = parseNumber(range[1]),
        high = parseNumber(range[2]);
      if (low.n < 0n || high.n * low.d < low.n * high.d) throw Error();
      return {
        kind: "range",
        low: formatNumber(low),
        high: formatNumber(high),
        text: raw,
      };
    }
    const n = parseNumber(s);
    if (n.n < 0n) throw Error();
    return { kind: "exact", low: formatNumber(n), high: null, text: raw };
  } catch {
    return { kind: "text", low: null, high: null, text: raw };
  }
}
export function scaleAmount(amount: Amount, factor: Rational): Amount {
  if (amount.kind === "missing" || amount.kind === "text") return { ...amount };
  if (!amount.low) throw Error("חסרה כמות בסיס");
  return {
    ...amount,
    low: formatNumber(multiply(parseNumber(amount.low), factor)),
    high: amount.high
      ? formatNumber(multiply(parseNumber(amount.high), factor))
      : null,
  };
}
export function amountText(amount: Amount) {
  return amount.kind === "exact"
    ? (amount.low ?? "כמות חסרה")
    : amount.kind === "range"
      ? `${amount.low}–${amount.high}`
      : amount.kind === "missing"
        ? "כמות חסרה"
        : amount.text;
}
export function scaleRecipe(content: RecipeContent, target: string) {
  if (!content.yield) throw Error("יש להשלים תפוקת בסיס");
  const base = parseNumber(content.yield.amount),
    desired = parseNumber(target);
  if (base.n <= 0n || desired.n <= 0n) throw Error("תפוקה חייבת להיות חיובית");
  const factor = divide(desired, base);
  const ingredients = content.ingredients.map((i) => ({
    ...i,
    amount: scaleAmount(i.amount, factor),
    alternatives: i.alternatives.map((a) => ({
      ...a,
      amount: scaleAmount(a.amount, factor),
    })),
  }));
  return {
    ...content,
    ingredients,
    steps: content.steps.map((step) => ({
      ...step,
      text: linkedStepText(step, ingredients),
    })),
  };
}
export function linkedStepText(step: RecipeStep, ingredients: Ingredient[]) {
  let text = step.text;
  for (const link of step.links) {
    const raw = ingredients.find((i) => i.id === link.ingredient_id);
    if (!raw || !link.placeholder) continue;
    const i = selectedIngredient(raw);
    const amount = scaleAmount(i.amount, parseNumber(link.portion));
    text = text
      .split(link.placeholder)
      .join(`${amountText(amount)} ${i.unit}`.trim());
  }
  return text;
}
const wholeEggs = (name: string) => /^(ביצה|ביצים)(\s|$)/.test(name.trim());
const eggMass = (unit: string) =>
  /^(גרם|גרמים|g|ק"ג|ק״ג|קג|kg)$/.test(unit.trim());
export function selectedIngredient(i: Ingredient): Ingredient {
  const alternative =
    i.selected_alternative === null
      ? undefined
      : i.alternatives[i.selected_alternative];
  const selected = alternative ? { ...i, ...alternative } : i;
  if (!wholeEggs(selected.name) || eggMass(selected.unit))
    return { ...selected, egg_size: null, egg_size_origin: null };
  return applyEggDefault(selected);
}
export function applyEggDefault(i: Ingredient): Ingredient {
  const whole = wholeEggs(i.name);
  const grams = eggMass(i.unit);
  if (
    whole &&
    !grams &&
    ["exact", "range"].includes(i.amount.kind) &&
    i.amount.low &&
    !i.egg_size
  )
    return { ...i, egg_size: "M", egg_size_origin: "default" };
  return i;
}
export function readiness(content: RecipeContent) {
  const problems: string[] = [];
  if (content.split_suggestion)
    problems.push("יש לבדוק מול המקור אם נדרש פיצול או איחוד, ולאשר את ההחלטה");
  if (!content.title.trim()) problems.push("חסר שם מתכון");
  if (!content.yield) problems.push("חסרה תפוקת בסיס");
  else {
    try {
      if (
        parseNumber(content.yield.amount).n <= 0n ||
        !content.yield.unit.trim()
      )
        throw Error();
    } catch {
      problems.push("תפוקת הבסיס אינה תקינה");
    }
  }
  if (!content.ingredients.length) problems.push("חסרים מצרכים");
  for (const i of content.ingredients) {
    if (!i.name.trim() || i.amount.kind === "missing")
      problems.push(`יש להשלים את המצרך: ${i.original || i.name || "ללא שם"}`);
    if (i.uncertainty) problems.push(`מצרך דורש בדיקה: ${i.name}`);
    if (i.alternatives.length && i.selected_alternative === null)
      problems.push(`יש לבחור חלופה עבור ${i.name}`);
    if (
      i.selected_alternative !== null &&
      (i.selected_alternative < -1 ||
        i.selected_alternative >= i.alternatives.length)
    )
      problems.push(`חלופה אינה תקינה: ${i.name}`);
    const selected = selectedIngredient(i);
    if (
      !selected.name.trim() ||
      selected.amount.kind === "missing" ||
      (selected.amount.kind === "text" && !selected.amount.text.trim())
    )
      problems.push(`יש להשלים את החלופה הנבחרת: ${i.name}`);
    for (const a of [i.amount, ...i.alternatives.map((a) => a.amount)])
      if (a.kind === "exact" || a.kind === "range") {
        try {
          if (
            !a.low ||
            parseNumber(a.low).n < 0n ||
            (a.kind === "exact" && a.high !== null) ||
            (a.kind === "range" && !a.high)
          )
            throw Error();
          if (
            a.high &&
            parseNumber(a.high).n * parseNumber(a.low).d <
              parseNumber(a.low).n * parseNumber(a.high).d
          )
            throw Error();
        } catch {
          problems.push(`כמות אינה תקינה: ${i.name}`);
        }
      }
  }
  if (!content.steps.length || content.steps.some((s) => !s.text.trim()))
    problems.push("יש להשלים שלבי הכנה");
  for (const u of content.uncertainties)
    problems.push(`${u.path}: ${u.reason}`);
  const ids = new Set(content.steps.map((s) => s.id));
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw Error();
    if (visited.has(id)) return;
    visiting.add(id);
    const s = content.steps.find((s) => s.id === id);
    for (const dep of s?.depends_on ?? []) {
      if (!ids.has(dep)) throw Error();
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
  };
  try {
    for (const s of content.steps) visit(s.id);
  } catch {
    problems.push("תלויות השלבים אינן תקינות");
  }
  if (
    content.active_minutes !== null &&
    content.total_minutes !== null &&
    content.total_minutes < content.active_minutes
  )
    problems.push("הזמן הכולל קצר מזמן העבודה; יש לבדוק מול המקור");
  const ingredientIds = new Set(content.ingredients.map((i) => i.id));
  for (const step of content.steps) {
    for (const link of step.links) {
      try {
        if (
          !ingredientIds.has(link.ingredient_id) ||
          !link.placeholder ||
          !step.text.includes(link.placeholder) ||
          parseNumber(link.portion).n <= 0n
        )
          throw Error();
      } catch {
        problems.push("קישור כמות בשלב דורש תיקון: " + step.id);
      }
    }
  }
  return [...new Set(problems)];
}
const conversions: Record<string, { unit: string; factor: string }> = {
  "ק״ג": { unit: "גרם", factor: "1000" },
  'ק"ג': { unit: "גרם", factor: "1000" },
  kg: { unit: "גרם", factor: "1000" },
  קג: { unit: "גרם", factor: "1000" },
  גרמים: { unit: "גרם", factor: "1" },
  g: { unit: "גרם", factor: "1" },
  גרם: { unit: "גרם", factor: "1" },
  ליטר: { unit: "מ״ל", factor: "1000" },
  l: { unit: "מ״ל", factor: "1000" },
  ml: { unit: "מ״ל", factor: "1" },
  "מ״ל": { unit: "מ״ל", factor: "1" },
  'מ"ל': { unit: "מ״ל", factor: "1" },
};
export function canonicalUnit(amount: Amount, unit: string) {
  const c = conversions[unit];
  return c
    ? { amount: scaleAmount(amount, parseNumber(c.factor)), unit: c.unit }
    : { amount, unit };
}
export function panRatio(
  from: { shape: "round" | "rectangle"; a: number; b: number; depth: number },
  to: { shape: "round" | "rectangle"; a: number; b: number; depth: number },
) {
  for (const p of [from, to])
    if (p.a <= 0 || p.b <= 0 || p.depth <= 0)
      throw Error("מידות התבנית חייבות להיות חיוביות");
  const area = (p: typeof from) =>
    p.shape === "round" ? Math.PI * (p.a / 2) ** 2 : p.a * p.b;
  return {
    ratio: (area(to) * to.depth) / (area(from) * from.depth),
    assumption:
      "יחס נפחים גאומטרי בלבד; זמני אפייה והתנהגות הבלילה דורשים בדיקה.",
  };
}
