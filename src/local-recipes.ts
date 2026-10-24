import { parseRecipeInput, recipeFingerprint, RecipeDataError, validateRecipe, type Recipe, type RecipeInput } from './domain.ts'

export const LOCAL_RECIPES_KEY = 'kort:recipes:v1'
export const LOCAL_OWNER = 'local-device'
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024
type RecipeStorage = Pick<Storage, 'getItem' | 'setItem'>
const maxRecipes = 2000

export function readLocalRecipes(storage: RecipeStorage): Recipe[] {
  let raw: string | null
  try { raw = storage.getItem(LOCAL_RECIPES_KEY) }
  catch { throw new RecipeDataError('אין גישה לשמירה בדפדפן. יש לאפשר אחסון מקומי ולנסות שוב.') }
  if (raw === null) return []
  try {
    const saved = JSON.parse(raw)
    if (saved?.version !== 1 || !Array.isArray(saved.recipes) || saved.recipes.length > maxRecipes) throw new Error()
    const ids = new Set<string>()
    return saved.recipes.map((value: unknown) => {
      const input = parseRecipeInput(value)
      const r = value as Record<string, unknown>
      if (typeof r.id !== 'string' || !r.id || ids.has(r.id) || r.owner_id !== LOCAL_OWNER ||
        typeof r.created_at !== 'string' || !Number.isFinite(Date.parse(r.created_at)) ||
        typeof r.updated_at !== 'string' || !Number.isFinite(Date.parse(r.updated_at))) throw new Error()
      ids.add(r.id)
      return { ...input, id: r.id, owner_id: LOCAL_OWNER, created_at: r.created_at, updated_at: r.updated_at }
    })
  } catch { throw new RecipeDataError('לא הצלחנו לפתוח את המתכונים השמורים. הנתונים המקוריים נשמרו ללא שינוי. אפשר להוריד עותק לשחזור.') }
}

function writeRecipes(storage: RecipeStorage, recipes: Recipe[]) {
  if (recipes.length > maxRecipes) throw new RecipeDataError('הספר המקומי מלא. אפשר לגבות את המתכונים בקובץ לפני שמוסיפים עוד.')
  try { storage.setItem(LOCAL_RECIPES_KEY, JSON.stringify({ version: 1, recipes })) }
  catch { throw new RecipeDataError('המתכון לא נשמר: האחסון בדפדפן חסום או מלא. כדאי להוריד גיבוי ולפנות מקום.') }
}

export function saveLocalRecipe(storage: RecipeStorage, input: RecipeInput, id?: string): Recipe {
  const recipes = readLocalRecipes(storage)
  const previous = id ? recipes.find(r => r.id === id) : undefined
  if (id && !previous) throw new RecipeDataError('המתכון אינו נמצא עוד בספר. כדאי לרענן את הרשימה.')
  const now = new Date().toISOString()
  const recipe: Recipe = { ...validateRecipe(input), id: previous?.id ?? crypto.randomUUID(), owner_id: LOCAL_OWNER,
    created_at: previous?.created_at ?? now, updated_at: now }
  writeRecipes(storage, [recipe, ...recipes.filter(r => r.id !== recipe.id)])
  return recipe
}

export function deleteLocalRecipe(storage: RecipeStorage, id: string) {
  const recipes = readLocalRecipes(storage)
  if (!recipes.some(r => r.id === id)) throw new RecipeDataError('המתכון כבר הוסר מהספר.')
  writeRecipes(storage, recipes.filter(r => r.id !== id))
}

export function encodeBackup(recipes: Recipe[]): string {
  return JSON.stringify({ format: 'kort-recipes', version: 1, exported_at: new Date().toISOString(),
    recipes: recipes.map(parseRecipeInput) }, null, 2)
}

export function decodeBackup(raw: string): RecipeInput[] {
  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) throw new RecipeDataError('קובץ הגיבוי גדול מדי. גודל הקובץ המרבי הוא 5MB.')
  let backup
  try { backup = JSON.parse(raw) }
  catch { throw new RecipeDataError('לא הצלחנו לקרוא את הקובץ. יש לבחור קובץ גיבוי של קורט.') }
  if (backup?.format !== 'kort-recipes' || backup.version !== 1 || !Array.isArray(backup.recipes) || backup.recipes.length > maxRecipes) {
    throw new RecipeDataError('זה אינו קובץ גיבוי נתמך של קורט.')
  }
  return backup.recipes.map(parseRecipeInput)
}

export function importLocalRecipes(storage: RecipeStorage, inputs: RecipeInput[]) {
  // Validate everything before writing. A malformed entry must not partially import a file.
  const validated = inputs.map(parseRecipeInput)
  const existing = readLocalRecipes(storage)
  const fingerprints = new Set(existing.map(recipeFingerprint))
  const added: Recipe[] = []
  const now = new Date().toISOString()
  for (const input of validated) {
    const fingerprint = recipeFingerprint(input)
    if (fingerprints.has(fingerprint)) continue
    fingerprints.add(fingerprint)
    added.push({ ...input, id: crypto.randomUUID(), owner_id: LOCAL_OWNER, created_at: now, updated_at: now })
  }
  if (added.length) writeRecipes(storage, [...added, ...existing])
  return { added: added.length, skipped: inputs.length - added.length }
}
