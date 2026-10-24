import { createClient } from '@supabase/supabase-js'
import type { Recipe, RecipeInput } from './domain.ts'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
// Public browser key only. Authorization is enforced by Postgres RLS.
export const supabase = url && key ? createClient(url, key, {
  auth: { storageKey: 'kort-recipes-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null
const table = 'recipe_book_recipes'
const columns = 'id,owner_id,title,description,category,prep_minutes,cook_minutes,servings,ingredients,instructions,image_url,favorite,created_at,updated_at'

export async function listRecipes(ownerId: string): Promise<Recipe[]> {
  if (!supabase) throw new Error('Not configured')
  const result: Recipe[] = []
  // Explicit pagination avoids Supabase's default 1,000-row response cap.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from(table).select(columns).eq('owner_id', ownerId)
      .order('updated_at', { ascending: false }).order('id').range(offset, offset + 499)
    if (error) throw error
    result.push(...data as Recipe[])
    if (data.length < 500) return result
  }
}
export async function saveRecipe(input: RecipeInput, ownerId: string, id?: string): Promise<Recipe> {
  if (!supabase) throw new Error('Not configured')
  const request = id
    ? supabase.from(table).update(input).eq('id', id).eq('owner_id', ownerId)
    : supabase.from(table).insert({ ...input, owner_id: ownerId })
  const { data, error } = await request.select(columns).single()
  if (error) throw error
  return data as Recipe
}
export async function deleteRecipe(id: string, ownerId: string) {
  if (!supabase) throw new Error('Not configured')
  const { data, error } = await supabase.from(table).delete().eq('id', id).eq('owner_id', ownerId).select('id').single()
  if (error) throw error
  return data
}
