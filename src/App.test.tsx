import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App.tsx'
import { encodeBackup, LOCAL_RECIPES_KEY, readLocalRecipes, saveLocalRecipe } from './local-recipes.ts'
import { demoRecipes } from './demo.ts'

vi.mock('./supabase.ts', () => ({ supabase: null, deleteRecipe: vi.fn(), listRecipes: vi.fn(), saveRecipe: vi.fn() }))

beforeEach(() => {
  localStorage.clear()
  // Native dialogs are supplied by browsers, but not implemented by jsdom.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('local recipe book', () => {
  it('creates, reloads, searches, favorites, edits and deletes without signing in', async () => {
    const firstRender = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'הוספת מתכון חדש' }))
    const form = screen.getByRole('dialog', { name: 'מתכון חדש לספר' })
    fireEvent.change(within(form).getByLabelText('שם המתכון *'), { target: { value: 'מרק העדשים שלי' } })
    fireEvent.change(within(form).getByLabelText(/מצרכים/), { target: { value: 'כוס עדשים\nבצל' } })
    fireEvent.change(within(form).getByLabelText(/אופן ההכנה/), { target: { value: 'מבשלים עד שמתרכך' } })
    fireEvent.click(within(form).getByRole('button', { name: 'שמירת המתכון' }))
    await screen.findByRole('button', { name: 'מרק העדשים שלי', exact: true })
    expect(readLocalRecipes(localStorage)).toHaveLength(1)
    firstRender.unmount()

    render(<App />)
    expect(screen.getByRole('button', { name: 'מרק העדשים שלי', exact: true })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'חיפוש מתכונים' }), { target: { value: 'לא קיים' } })
    expect(screen.getByText('לא מצאנו כאן מתכונים')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ניקוי החיפוש' }))
    fireEvent.click(screen.getByRole('button', { name: 'הוספת מרק העדשים שלי למועדפים' }))
    expect(readLocalRecipes(localStorage)[0].favorite).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'מרק העדשים שלי', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'עריכת המתכון' }))
    fireEvent.change(screen.getByLabelText('שם המתכון *'), { target: { value: 'המרק המשודרג שלי' } })
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המתכון' }))
    await screen.findByRole('button', { name: 'המרק המשודרג שלי', exact: true })
    fireEvent.click(screen.getByRole('button', { name: 'המרק המשודרג שלי', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'מחיקה', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }))
    await screen.findByText('כל ספר טוב מתחיל במתכון אחד')
    expect(readLocalRecipes(localStorage)).toHaveLength(0)
  })

  it('keeps inspiration separate and saves an editable copy on request', async () => {
    render(<App />)
    expect(readLocalRecipes(localStorage)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'מתכונים להשראה' }))
    fireEvent.click(screen.getByRole('button', { name: 'פסטה עגבניות ובזיליקום', exact: true }))
    expect(screen.queryByRole('button', { name: 'עריכת המתכון' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'שמירת עותק בספר שלי' }))
    await screen.findByRole('button', { name: 'פסטה עגבניות ובזיליקום', exact: true })
    expect(readLocalRecipes(localStorage)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'הספר שלי' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows corrupted-storage recovery and does not overwrite saved data', () => {
    localStorage.setItem(LOCAL_RECIPES_KEY, '{broken')
    render(<App />)
    expect(screen.getByRole('alert').textContent).toContain('הנתונים המקוריים נשמרו ללא שינוי')
    expect(screen.getByRole('button', { name: 'הורדת עותק לשחזור' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'הוספת מתכון חדש' }) as HTMLButtonElement).disabled).toBe(true)
    expect(localStorage.getItem(LOCAL_RECIPES_KEY)).toBe('{broken')
  })

  it('imports a backup through the interface without duplicating existing recipes', async () => {
    const saved = saveLocalRecipe(localStorage, demoRecipes[0])
    render(<App />)
    const backup = encodeBackup([saved, { ...demoRecipes[1], owner_id: 'ignored', id: 'ignored' }])
    const file = new File([backup], 'recipes.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => backup })
    fireEvent.change(screen.getByLabelText('בחירת קובץ גיבוי'), { target: { files: [file] } })
    await screen.findByText('נוספו 1 מתכונים לספר. מתכונים זהים דולגו.')
    expect(readLocalRecipes(localStorage)).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'סלט של שוק', exact: true })).toBeTruthy()
  })

  it('reports failed storage writes without pretending a sample was saved', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'מתכונים להשראה' }))
    fireEvent.click(screen.getByRole('button', { name: 'פסטה עגבניות ובזיליקום', exact: true }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    fireEvent.click(screen.getByRole('button', { name: 'שמירת עותק בספר שלי' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('המתכון לא נשמר'))
    expect(readLocalRecipes(localStorage)).toHaveLength(0)
    expect(screen.getByRole('dialog', { name: 'פסטה עגבניות ובזיליקום' })).toBeTruthy()
  })
})
