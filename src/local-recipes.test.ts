import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeBackup, deleteLocalRecipe, encodeBackup, importLocalRecipes, LOCAL_RECIPES_KEY, readLocalRecipes, saveLocalRecipe } from './local-recipes.ts'
import type { RecipeInput } from './domain.ts'

class MemoryStorage {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
}
const input: RecipeInput = { title: 'סלט ירוק', description: '', category: 'סלטים', prep_minutes: 10,
  cook_minutes: 0, servings: 2, ingredients: ['מלפפון', 'לימון'], instructions: ['קוצצים'], image_url: null, favorite: false }

test('local CRUD survives a new read, preserves IDs and does not overwrite other recipes', () => {
  const storage = new MemoryStorage()
  const first = saveLocalRecipe(storage, input)
  const second = saveLocalRecipe(storage, { ...input, title: 'מתכון מלשונית אחרת' })
  const updated = saveLocalRecipe(storage, { ...input, title: 'סלט משודרג', favorite: true }, first.id)
  assert.equal(updated.id, first.id)
  assert.equal(updated.created_at, first.created_at)
  assert.equal(readLocalRecipes(storage).length, 2)
  assert.equal(readLocalRecipes(storage)[0].favorite, true)
  deleteLocalRecipe(storage, first.id)
  assert.deepEqual(readLocalRecipes(storage).map(r => r.id), [second.id])
  assert.throws(() => saveLocalRecipe(storage, input, first.id))
})

test('backup roundtrip merges recipes and skips duplicates even after favorite changes', () => {
  const original = new MemoryStorage()
  const saved = saveLocalRecipe(original, input)
  const backup = decodeBackup(encodeBackup([saved]))
  const target = new MemoryStorage()
  assert.deepEqual(importLocalRecipes(target, [...backup, ...backup]), { added: 1, skipped: 1 })
  const copied = readLocalRecipes(target)[0]
  saveLocalRecipe(target, { ...input, favorite: true }, copied.id)
  assert.deepEqual(importLocalRecipes(target, backup), { added: 0, skipped: 1 })
  assert.equal(readLocalRecipes(target)[0].favorite, true)
  assert.notEqual(copied.id, saved.id)
})

test('corrupt and unsupported stored data are preserved and cannot be silently overwritten', () => {
  for (const raw of ['{broken', '{"version":2,"recipes":[]}', '{"version":1,"recipes":[{"title":42}]}']) {
    const storage = new MemoryStorage()
    storage.setItem(LOCAL_RECIPES_KEY, raw)
    assert.throws(() => readLocalRecipes(storage))
    assert.throws(() => saveLocalRecipe(storage, input))
    assert.equal(storage.getItem(LOCAL_RECIPES_KEY), raw)
  }
})

test('failed writes and invalid imports leave the previous library intact', () => {
  const storage = new MemoryStorage()
  saveLocalRecipe(storage, input)
  const before = storage.getItem(LOCAL_RECIPES_KEY)
  assert.throws(() => importLocalRecipes(storage, [{ ...input, title: 'עוד מתכון' }, { ...input, servings: -1 }]))
  assert.equal(storage.getItem(LOCAL_RECIPES_KEY), before)
  const full = { getItem: (key: string) => storage.getItem(key), setItem() { throw new Error('quota') } }
  assert.throws(() => saveLocalRecipe(full, { ...input, title: 'לא נשמר' }), /האחסון בדפדפן חסום או מלא/)
  assert.equal(storage.getItem(LOCAL_RECIPES_KEY), before)
})

test('backup validation rejects unrelated files, malformed entries and unsafe images', () => {
  for (const raw of ['<html></html>', '{}', '{"format":"kort-recipes","version":2,"recipes":[]}',
    JSON.stringify({ format: 'kort-recipes', version: 1, recipes: [{ ...input, instructions: 'wrong type' }] }),
    JSON.stringify({ format: 'kort-recipes', version: 1, recipes: [{ ...input, image_url: 'javascript:alert(1)' }] })]) {
    assert.throws(() => decodeBackup(raw))
  }
})
