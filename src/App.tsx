import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowLeft, BookOpen, ChefHat, Check, Clock3, Heart, Leaf, LogOut, Pencil, Plus, Search, SlidersHorizontal, Soup, Trash2, Users, X } from 'lucide-react'
import { categories, filterRecipes, friendlyError, validateRecipe, type Recipe, type RecipeInput } from './domain.ts'
import { deleteRecipe, listRecipes, saveRecipe, supabase } from './supabase.ts'
import { demoRecipes } from './demo.ts'

function Modal({ title, children, close, busy = false, wide = false }: { title: string; children: ReactNode; close: () => void; busy?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} className={wide ? 'modal wide' : 'modal'} aria-label={title}
    onCancel={event => { event.preventDefault(); if (!busy) close() }}
    onClick={event => { if (event.target === ref.current && !busy) close() }}>
    <div className="modal-inner">
      <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="סגירה" disabled={busy} onClick={close}><X size={21} /></button></div>
      {children}
    </div>
  </dialog>
}

function Auth({ close }: { close: () => void }) {
  const [signup, setSignup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const credentials = { email: String(form.get('email')).trim(), password: String(form.get('password')) }
    try {
      const { data, error } = signup ? await supabase.auth.signUp(credentials) : await supabase.auth.signInWithPassword(credentials)
      if (error) throw error
      if (data.session) close()
      else setMessage('אם נדרש אישור כתובת, יישלח אליך אימייל. לאחר האישור אפשר לחזור לכאן ולהתחבר.')
    } catch (err) { setError(friendlyError(err)) }
    finally { setBusy(false) }
  }
  return <Modal title={signup ? 'פותחים את ספר המתכונים שלך' : 'איזה כיף שחזרת'} close={close} busy={busy}>
    <p className="muted">מתחברים כדי לשמור מתכונים ולמצוא אותם מכל מכשיר.</p>
    {!supabase ? <div className="notice">השמירה בענן עדיין לא חוברה. אפשר בינתיים לעיין במתכונים לדוגמה.</div> : <>
      <form onSubmit={submit} className="form-stack">
        <label>אימייל<input name="email" type="email" dir="ltr" autoComplete="email" required maxLength={254} placeholder="you@example.com" /></label>
        <label>סיסמה<input name="password" type="password" dir="ltr" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 8 : 1} maxLength={128} /></label>
        {signup && <small className="muted">לפחות 8 תווים. מומלץ לשלב אותיות, מספרים וסימנים.</small>}
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="success" role="status">{message}</p>}
        <button className="button primary" disabled={busy}>{busy ? 'רק רגע…' : signup ? 'יצירת חשבון' : 'כניסה לספר שלי'}</button>
      </form>
      <button className="text-button auth-switch" disabled={busy} onClick={() => { setSignup(!signup); setError(''); setMessage('') }}>{signup ? 'כבר יש לך חשבון? מתחברים כאן' : 'פעם ראשונה כאן? יוצרים חשבון'}</button>
    </>}
  </Modal>
}

function RecipeForm({ recipe, close, save }: { recipe?: Recipe; close: () => void; save: (input: RecipeInput, id?: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    const form = new FormData(event.currentTarget)
    let input: RecipeInput
    try {
      input = validateRecipe({
        title: String(form.get('title')), description: String(form.get('description')),
        category: String(form.get('category')) as RecipeInput['category'],
        prep_minutes: Number(form.get('prep_minutes')), cook_minutes: Number(form.get('cook_minutes')), servings: Number(form.get('servings')),
        ingredients: String(form.get('ingredients')).split('\n'), instructions: String(form.get('instructions')).split('\n'),
        image_url: String(form.get('image_url')) || null, favorite: recipe?.favorite || false,
      })
    } catch (err) { setError((err as Error).message); return }
    setBusy(true)
    try { await save(input, recipe?.id); close() }
    catch (err) { setError(friendlyError(err)); setBusy(false) }
  }
  return <Modal title={recipe ? 'עוד נגיעה קטנה למתכון' : 'מתכון חדש לספר'} close={close} wide busy={busy}>
    <p className="muted">מהמנה שתמיד מצליחה ועד הניסוי הבא במטבח.</p>
    <form onSubmit={submit} className="form-stack">
      <label>שם המתכון *<input name="title" defaultValue={recipe?.title} required minLength={2} maxLength={120} placeholder="למשל, עוגת השוקולד של סבתא" /></label>
      <label>כמה מילים על המתכון<textarea name="description" defaultValue={recipe?.description} maxLength={2000} rows={2} placeholder="מה הופך אותו למיוחד?" /></label>
      <div className="form-grid"><label>קטגוריה<select name="category" defaultValue={recipe?.category || 'עיקריות'}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>מספר מנות<input type="number" name="servings" required min={1} max={100} step={1} defaultValue={recipe?.servings ?? 4} /></label>
        <label>זמן הכנה (דקות)<input type="number" name="prep_minutes" required min={0} max={10080} step={1} defaultValue={recipe?.prep_minutes ?? 10} /></label>
        <label>זמן בישול (דקות)<input type="number" name="cook_minutes" required min={0} max={10080} step={1} defaultValue={recipe?.cook_minutes ?? 20} /></label></div>
      <label>מצרכים *<small>כל מצרך בשורה נפרדת, כולל הכמות.</small><textarea name="ingredients" required rows={5} maxLength={50000} defaultValue={recipe?.ingredients.join('\n')} placeholder={'2 כוסות קמח\n1 כפית מלח\n3 כפות שמן זית'} /></label>
      <label>אופן ההכנה *<small>כל שלב בשורה נפרדת.</small><textarea name="instructions" required rows={5} maxLength={50000} defaultValue={recipe?.instructions.join('\n')} placeholder="כאן מתחיל הקסם…" /></label>
      <label>קישור לתמונה (לא חובה)<input type="url" name="image_url" dir="ltr" maxLength={2048} defaultValue={recipe?.image_url || ''} placeholder="https://…" /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions"><button className="button primary" disabled={busy}>{busy ? 'שומרים…' : 'שמירת המתכון'}</button><button className="button quiet" type="button" disabled={busy} onClick={close}>ביטול</button></div>
    </form>
  </Modal>
}

function RecipeImage({ recipe, className = '' }: { recipe: Recipe; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [recipe.image_url])
  return recipe.image_url && !failed ? <img className={className} src={recipe.image_url} alt={recipe.title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <div className={`food-placeholder ${className}`} role="img" aria-label="מתכון ללא תמונה"><Soup size={62} strokeWidth={1} /><span>משהו טוב מתבשל</span></div>
}

function RecipeDetails({ recipe, editable, close, edit, remove }: { recipe: Recipe; editable: boolean; close: () => void; edit: () => void; remove: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  async function handleDelete() {
    setBusy(true); setError('')
    try { await remove(); close() }
    catch (err) { setError(friendlyError(err)); setBusy(false) }
  }
  return <Modal title={recipe.title} close={close} wide busy={busy}>
    <RecipeImage recipe={recipe} className="detail-image" />
    <div className="detail-meta"><span className="tag">{recipe.category}</span><span><Clock3 size={16} /> {recipe.prep_minutes + recipe.cook_minutes} דקות</span><span><Users size={16} /> {recipe.servings} מנות</span></div>
    <p className="detail-description">{recipe.description}</p>
    <div className="recipe-columns"><section><h3>מה צריך?</h3><p className="muted small">אפשר לסמן את מה שכבר מוכן.</p><ul className="ingredients">{recipe.ingredients.map((line, i) => <li key={i}><label className={checked.has(i) ? 'checked' : ''}><input type="checkbox" checked={checked.has(i)} onChange={() => setChecked(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next })} /><span>{line}</span></label></li>)}</ul></section>
      <section><h3>איך מכינים?</h3><ol className="steps">{recipe.instructions.map((line, i) => <li key={i}><span>{i + 1}</span><p>{line}</p></li>)}</ol></section></div>
    <p className="muted small">הכנה: {recipe.prep_minutes} דקות · בישול: {recipe.cook_minutes} דקות</p>
    {!editable && <div className="notice">זהו מתכון לדוגמה. אחרי ההתחברות אפשר לבנות ספר מתכונים משלך.</div>}
    {editable && <div className="detail-actions"><button className="button quiet" onClick={edit} disabled={busy}><Pencil size={16} /> עריכת המתכון</button>
      {!confirmDelete ? <button className="text-button danger" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> מחיקה</button> : <div className="delete-confirm"><span>למחוק את המתכון לצמיתות?</span><button className="button danger-button" disabled={busy} onClick={handleDelete}>{busy ? 'מוחקים…' : 'כן, למחוק'}</button><button className="text-button" disabled={busy} onClick={() => setConfirmDelete(false)}>ביטול</button></div>}</div>}
    {error && <p className="error" role="alert">{error}</p>}
  </Modal>
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [favorites, setFavorites] = useState(false)
  const [sort, setSort] = useState('recent')
  const [authOpen, setAuthOpen] = useState(false)
  const [editor, setEditor] = useState<Recipe | 'new' | null>(null)
  const [selected, setSelected] = useState<Recipe | null>(null)
  const [notice, setNotice] = useState('')
  const [mutationBusy, setMutationBusy] = useState(false)
  const owner = useRef<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    let active = true
    let authEventReceived = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true
      if (!active) return
      const nextOwner = session?.user.id ?? null
      if (nextOwner !== owner.current) { setRecipes([]); setSelected(null); setEditor(null); setNotice(''); setQuery(''); setCategory(''); setFavorites(false) }
      owner.current = nextOwner
      setUser(session?.user ?? null); setAuthReady(true)
    })
    // Server-verified identity for the initial user display; RLS guards every data request.
    supabase.auth.getUser().then(({ data }) => {
      if (active && !authEventReceived) { owner.current = data.user?.id ?? null; setUser(data.user); setAuthReady(true) }
    }).catch(() => { if (active && !authEventReceived) { setAuthReady(true); setLoadError('לא הצלחנו לבדוק את ההתחברות. אפשר לרענן ולנסות שוב.') } })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!user) { setRecipes([]); setLoading(false); return }
    let active = true
    setLoading(true); setLoadError('')
    listRecipes(user.id).then(data => { if (active) setRecipes(data) })
      .catch(error => { if (active) setLoadError(friendlyError(error)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user?.id, reload])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 5500)
    return () => clearTimeout(timer)
  }, [notice])

  async function handleSave(input: RecipeInput, id?: string) {
    if (!user) throw new Error('Sign in required')
    const saved = await saveRecipe(input, user.id, id)
    if (owner.current !== user.id) throw new Error('Account changed')
    setRecipes(prev => [saved, ...prev.filter(r => r.id !== saved.id)])
    setNotice('המתכון נשמר בספר שלך')
  }
  async function toggleFavorite(recipe: Recipe) {
    if (!user) { setAuthOpen(true); return }
    if (mutationBusy) return
    setMutationBusy(true)
    try {
      await handleSave({ ...recipeInput(recipe), favorite: !recipe.favorite }, recipe.id)
      setNotice(recipe.favorite ? 'המתכון הוסר מהמועדפים' : 'המתכון נוסף למועדפים')
    } catch (err) { if (owner.current === user.id) setNotice(friendlyError(err)) }
    finally { setMutationBusy(false) }
  }
  async function logout() {
    if (!supabase) return
    setMutationBusy(true)
    try { const { error } = await supabase.auth.signOut({ scope: 'local' }); if (error) throw error }
    catch (err) { setNotice(friendlyError(err)) }
    finally { setMutationBusy(false) }
  }

  const source = user ? recipes.filter(r => r.owner_id === user.id) : demoRecipes
  const visible = filterRecipes(source, query, category, favorites).sort((a, b) => sort === 'quick' ? (a.prep_minutes + a.cook_minutes) - (b.prep_minutes + b.cook_minutes) : sort === 'name' ? a.title.localeCompare(b.title, 'he') : b.updated_at.localeCompare(a.updated_at))
  const add = () => user ? setEditor('new') : setAuthOpen(true)

  return <>
    <a className="skip-link" href="#recipes">דילוג למתכונים</a>
    <header className="site-header"><div className="header-content"><a className="brand" href="#" aria-label="קורט — הבית"><span className="brand-mark"><ChefHat size={27} strokeWidth={1.6} /></span><span>קורט<span className="brand-dot">.</span></span></a>
      <nav aria-label="ניווט ראשי"><button className={!favorites ? 'nav-link active' : 'nav-link'} onClick={() => setFavorites(false)}>ספר המתכונים</button><button className={favorites ? 'nav-link active' : 'nav-link'} onClick={() => setFavorites(true)}><Heart size={16} /> המועדפים שלי</button></nav>
      <div className="header-account">{user ? <button className="account-button" disabled={mutationBusy} onClick={logout} title={user.email}><span className="avatar">{(user.email?.[0] || 'ק').toUpperCase()}</span><span>יציאה</span><LogOut size={16} /></button> : <button className="button quiet login-button" onClick={() => setAuthOpen(true)}>כניסה לספר שלי <ArrowLeft size={16} /></button>}</div>
    </div></header>
    <main>
      <section className="hero"><div className="hero-copy"><div className="eyebrow"><span /> קצת השראה, הרבה טעם</div><h1>כל מתכון הוא<br />סיפור <em>ששווה לשמור.</em></h1><p>הטעמים של הבית, הניסיונות המוצלחים והמתכונים<br className="desktop-break" /> שעוברים הלאה. כולם נפגשים בספר אחד, שלך.</p><button className="button primary" onClick={add}><Plus size={19} /> הוספת מתכון חדש</button><div className="hero-note"><BookOpen size={15} /> מקום קטן לכל הדברים הטעימים</div></div>
        <div className="hero-visual" aria-hidden="true"><img className="hero-photo" src="https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=1000&q=85" alt="" fetchPriority="high" /><span className="photo-caption">מרכיבים פשוטים. רגעים טובים.</span><div className="floating-note"><Leaf size={25} strokeWidth={1.4} /><div>עשוי באהבה<small>ועוד קורט של השראה</small></div></div><span className="visual-scribble">בתיאבון!</span></div>
      </section>

      <section className="collection" id="recipes" aria-labelledby="collection-title"><div className="section-heading"><div><div className="eyebrow">האוסף האישי</div><h2 id="collection-title">{favorites ? 'הכי אוהבים להכין' : 'מה מתבשל היום?'}<span>{source.length} {user ? 'מתכונים בספר' : 'מתכונים לדוגמה'}</span></h2></div><button className="button outline" onClick={add}><Plus size={17} /> מתכון חדש</button></div>
        {!user && authReady && <div className="demo-banner"><span><BookOpen size={17} /> טעימה קטנה מהספר שלך — אלה מתכונים לדוגמה.</span><button className="text-button" onClick={() => setAuthOpen(true)}>מתחברים ומתחילים לשמור <ArrowLeft size={15} /></button></div>}
        <div className="toolbar"><label className="search"><Search size={20} /><input aria-label="חיפוש מתכונים" placeholder="איזה מתכון מחפשים? שם, מצרך, טעם…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="icon-button" aria-label="ניקוי החיפוש" onClick={() => setQuery('')}><X size={16} /></button>}</label><label className="sort"><SlidersHorizontal size={17} /><span className="sr-only">מיון מתכונים</span><select aria-label="מיון מתכונים" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">נוספו לאחרונה</option><option value="quick">הכי מהירים להכנה</option><option value="name">לפי שם המתכון</option></select></label></div>
        <div className="categories" aria-label="סינון לפי קטגוריה"><button className={!category ? 'chip selected' : 'chip'} aria-pressed={!category} onClick={() => setCategory('')}>הכול <span>{source.length}</span></button>{categories.map(c => <button key={c} className={category === c ? 'chip selected' : 'chip'} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div>
        {!authReady || loading ? <div className="empty-state" role="status"><span className="loader" /> פותחים את ספר המתכונים…</div> : loadError ? <div className="empty-state" role="alert"><p>{loadError}</p><button className="button outline" onClick={() => setReload(x => x + 1)}>ניסיון נוסף</button></div> : visible.length ? <div className="recipe-grid">{visible.map(recipe => <article className="recipe-card" key={recipe.id}><div className="card-picture"><button className="picture-link" onClick={() => setSelected(recipe)} aria-label={`פתיחת המתכון ${recipe.title}`}><RecipeImage recipe={recipe} /></button><span className="card-category">{recipe.category}</span><button className={recipe.favorite ? 'favorite-button is-favorite' : 'favorite-button'} disabled={mutationBusy} onClick={() => toggleFavorite(recipe)} aria-label={recipe.favorite ? `הסרת ${recipe.title} מהמועדפים` : `הוספת ${recipe.title} למועדפים`} aria-pressed={recipe.favorite}><Heart size={19} fill={recipe.favorite ? 'currentColor' : 'none'} /></button></div><div className="card-body"><button className="card-title" onClick={() => setSelected(recipe)}><h3>{recipe.title}</h3></button><p>{recipe.description || 'עוד מתכון טוב ששווה לשמור קרוב.'}</p><div className="card-footer"><span><Clock3 size={15} /> {recipe.prep_minutes + recipe.cook_minutes} דקות</span><span><Users size={15} /> {recipe.servings} מנות</span><button className="recipe-arrow" onClick={() => setSelected(recipe)} aria-label={`למתכון ${recipe.title}`}><ArrowLeft size={19} /></button></div></div></article>)}</div> : <div className="empty-state"><Soup size={44} strokeWidth={1.2} /><h3>{query || category || favorites ? 'לא מצאנו כאן מתכונים' : 'כל ספר טוב מתחיל במתכון אחד'}</h3><p>{query || category || favorites ? 'אפשר לחפש משהו אחר או להסיר את הסינון.' : 'זה הזמן לשמור את המנה שתמיד מבקשים ממך להכין.'}</p>{query || category || favorites ? <button className="button outline" onClick={() => { setQuery(''); setCategory(''); setFavorites(false) }}>הצגת כל המתכונים</button> : <button className="button primary" onClick={add}><Plus size={17} /> המתכון הראשון שלי</button>}</div>}
      </section>
      <aside className="closing-note"><Leaf size={26} strokeWidth={1.2} /><p>המתכונים הכי טובים הם אלה שחוזרים אליהם.</p><span>שומרים היום, מבשלים שוב מחר.</span></aside>
    </main>
    <footer><a className="brand small-brand" href="#">קורט.</a><span>ספר קטן. טעמים גדולים.</span><span>נוצר בשביל המטבח שלך <Heart size={13} /></span></footer>
    {notice && <div className="toast" role="status"><Check size={17} /><span>{notice}</span><button className="icon-button" aria-label="סגירת הודעה" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {authOpen && <Auth close={() => setAuthOpen(false)} />}
    {editor && user && <RecipeForm recipe={editor === 'new' ? undefined : editor} close={() => setEditor(null)} save={handleSave} />}
    {selected && <RecipeDetails key={selected.id} recipe={selected} editable={!!user} close={() => setSelected(null)} edit={() => { setEditor(selected); setSelected(null) }} remove={async () => { if (!user) throw new Error('Sign in required'); await deleteRecipe(selected.id, user.id); if (owner.current === user.id) { setRecipes(prev => prev.filter(r => r.id !== selected.id)); setNotice('המתכון נמחק') } }} />}
  </>
}

function recipeInput(recipe: Recipe): RecipeInput {
  const { title, description, category, prep_minutes, cook_minutes, servings, ingredients, instructions, image_url, favorite } = recipe
  return { title, description, category, prep_minutes, cook_minutes, servings, ingredients, instructions, image_url, favorite }
}
