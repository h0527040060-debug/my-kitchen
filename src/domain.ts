export const categories = ['ארוחות בוקר', 'עיקריות', 'סלטים', 'מרקים', 'מאפים', 'קינוחים', 'אחר'] as const
export type Category = typeof categories[number]

export interface RecipeInput {
  title: string
  description: string
  category: Category
  prep_minutes: number
  cook_minutes: number
  servings: number
  ingredients: string[]
  instructions: string[]
  image_url: string | null
  favorite: boolean
}
export interface Recipe extends RecipeInput {
  id: string
  owner_id: string
  created_at: string
  updated_at: string
}

export class RecipeDataError extends Error {}

// Treat browser storage and backup files as untrusted input.
export function parseRecipeInput(value: unknown): RecipeInput {
  if (!value || typeof value !== 'object') throw new RecipeDataError('נתוני המתכון אינם תקינים.')
  const r = value as Record<string, unknown>
  if (typeof r.title !== 'string' || typeof r.description !== 'string' || typeof r.category !== 'string' ||
    typeof r.prep_minutes !== 'number' || typeof r.cook_minutes !== 'number' || typeof r.servings !== 'number' ||
    typeof r.favorite !== 'boolean' || !(r.image_url === null || typeof r.image_url === 'string') ||
    !Array.isArray(r.ingredients) || !r.ingredients.every(s => typeof s === 'string') ||
    !Array.isArray(r.instructions) || !r.instructions.every(s => typeof s === 'string')) {
    throw new RecipeDataError('נתוני המתכון אינם תקינים.')
  }
  try {
    return validateRecipe({ title: r.title, description: r.description, category: r.category as Category,
      prep_minutes: r.prep_minutes, cook_minutes: r.cook_minutes, servings: r.servings,
      ingredients: r.ingredients as string[], instructions: r.instructions as string[], image_url: r.image_url, favorite: r.favorite })
  } catch { throw new RecipeDataError('אחד המתכונים בקובץ אינו תקין. לא בוצעו שינויים.') }
}

export function recipeFingerprint(recipe: RecipeInput) {
  const { favorite: _favorite, ...content } = parseRecipeInput(recipe)
  // Favorite preferences do not turn an already imported recipe into a new one.
  return JSON.stringify(content)
}

export function validateRecipe(input: RecipeInput): RecipeInput {
  const title = input.title.trim()
  if (title.length < 2 || title.length > 120) throw new Error('שם המתכון צריך להכיל בין 2 ל־120 תווים.')
  if (input.description.length > 2000) throw new Error('התיאור ארוך מדי (עד 2,000 תווים).')
  if (!categories.includes(input.category)) throw new Error('יש לבחור קטגוריה מהרשימה.')
  for (const minutes of [input.prep_minutes, input.cook_minutes]) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) throw new Error('זמן ההכנה והבישול צריך להיות מספר שלם בין 0 ל־10,080 דקות.')
  }
  if (!Number.isInteger(input.servings) || input.servings < 1 || input.servings > 100) throw new Error('מספר המנות צריך להיות בין 1 ל־100.')
  const ingredients = input.ingredients.map(s => s.trim()).filter(Boolean)
  const instructions = input.instructions.map(s => s.trim()).filter(Boolean)
  for (const lines of [ingredients, instructions]) {
    if (lines.length < 1 || lines.length > 100 || lines.some(s => s.length > 2000)) throw new Error('יש להזין 1–100 מצרכים ושלבים, עד 2,000 תווים בכל שורה.')
  }
  let image_url = input.image_url?.trim() || null
  if (image_url) {
    try {
      const url = new URL(image_url)
      if (url.protocol !== 'https:' || url.username || url.password || image_url.length > 2048) throw new Error()
      image_url = url.href
    } catch { throw new Error('יש להזין קישור תקין לתמונה שמתחיל ב־https://.') }
  }
  return { ...input, title, description: input.description.trim(), ingredients, instructions, image_url }
}

export function filterRecipes(recipes: Recipe[], query: string, category: string, favorites: boolean) {
  const needle = query.trim().toLocaleLowerCase('he')
  return recipes.filter(r => (!favorites || r.favorite) && (!category || r.category === category) &&
    (!needle || [r.title, r.description, ...r.ingredients].join(' ').toLocaleLowerCase('he').includes(needle)))
}

export function friendlyError(error: unknown): string {
  if (error instanceof RecipeDataError) return error.message
  const code = (error as { code?: string })?.code
  if (code === 'invalid_credentials') return 'כתובת האימייל או הסיסמה לא נכונות.'
  if (code === 'email_not_confirmed') return 'יש לאשר את כתובת האימייל לפני ההתחברות.'
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return 'בוצעו יותר מדי ניסיונות. כדאי להמתין כמה דקות ולנסות שוב.'
  if (code === 'signup_disabled') return 'ההרשמה כרגע סגורה. אפשר להתחבר עם חשבון קיים.'
  if (code === 'weak_password') return 'יש לבחור סיסמה חזקה יותר.'
  if (error instanceof TypeError) return 'לא הצלחנו להתחבר. כדאי לבדוק את חיבור האינטרנט ולנסות שוב.'
  return 'הפעולה לא הושלמה. אפשר לנסות שוב בעוד רגע.'
}
