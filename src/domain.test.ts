import test from 'node:test'
import assert from 'node:assert/strict'
import { filterRecipes, validateRecipe, type Recipe, type RecipeInput } from './domain.ts'

const valid: RecipeInput = { title: ' סלט ירוק ', description: '', category: 'סלטים', prep_minutes: 10, cook_minutes: 0, servings: 2, ingredients: [' מלפפון ', '', 'לימון'], instructions: [' מערבבים '], image_url: null, favorite: false }

test('normalizes recipe fields and removes blank lines', () => {
  const result = validateRecipe(valid)
  assert.equal(result.title, 'סלט ירוק')
  assert.deepEqual(result.ingredients, ['מלפפון', 'לימון'])
  assert.deepEqual(result.instructions, ['מערבבים'])
})

test('rejects invalid times, servings, empty steps and excessively long input', () => {
  for (const patch of [{ prep_minutes: -1 }, { cook_minutes: NaN }, { servings: 1.5 }, { servings: 0 }, { ingredients: ['  '] }, { instructions: [] }, { instructions: ['א'.repeat(2001)] }, { title: 'א'.repeat(121) }]) {
    assert.throws(() => validateRecipe({ ...valid, ...patch }))
  }
})

test('image URLs allow only HTTPS and reject embedded credentials', () => {
  for (const image_url of ['javascript:alert(1)', 'data:image/svg+xml,test', 'http://example.com/a.jpg', 'https://user:password@example.com/a.jpg', 'not-a-url']) {
    assert.throws(() => validateRecipe({ ...valid, image_url }))
  }
  assert.equal(validateRecipe({ ...valid, image_url: 'https://example.com/photo.jpg' }).image_url, 'https://example.com/photo.jpg')
})

test('search finds ingredients and combines category and favorite filters', () => {
  const a: Recipe = { ...validateRecipe(valid), id: '1', owner_id: 'a', created_at: '', updated_at: '', favorite: true }
  const b: Recipe = { ...a, id: '2', category: 'עיקריות', favorite: false }
  assert.deepEqual(filterRecipes([a, b], ' לימון ', 'סלטים', true).map(r => r.id), ['1'])
  assert.deepEqual(filterRecipes([a, b], 'פסטה', '', false), [])
  assert.equal(filterRecipes([a, b], '', '', false).length, 2)
})
