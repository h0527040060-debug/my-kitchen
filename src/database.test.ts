import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Real, isolated Postgres engine. No network or live Supabase writes.
test('migration enforces anonymous denial, owner isolation and immutable ownership', async () => {
  const db = new PGlite()
  const userA = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
  const userB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to public;
      grant usage on schema public to anon, authenticated;
      insert into auth.users values ('${userA}'), ('${userB}');
    `)
    const migration = await readFile(new URL('../supabase/migrations/20261024180101_recipe_book.sql', import.meta.url), 'utf8')
    await db.exec(migration)

    await db.exec('set role anon')
    await assert.rejects(db.query('select * from public.recipe_book_recipes'), { code: '42501' })
    await db.exec('set role authenticated')
    // Authenticated role with no uid must not inherit another user's access.
    assert.equal((await db.query('select * from public.recipe_book_recipes')).rows.length, 0)
    await assert.rejects(db.query(`insert into public.recipe_book_recipes
      (owner_id,title,ingredients,instructions) values ($1,'סלט',array['מלפפון'],array['קוצצים'])`, [userA]), { code: '42501' })

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userA])
    const saved = await db.query<{ id: string }>(`insert into public.recipe_book_recipes
      (owner_id,title,ingredients,instructions) values ($1,'סלט',array['מלפפון'],array['קוצצים']) returning id`, [userA])
    const id = saved.rows[0].id
    assert.equal((await db.query('select * from public.recipe_book_recipes')).rows.length, 1)
    // Column grants also forbid moving ownership or forging server timestamps.
    await assert.rejects(db.query('update public.recipe_book_recipes set owner_id = $1 where id = $2', [userB, id]), { code: '42501' })
    await assert.rejects(db.query('update public.recipe_book_recipes set created_at = now() where id = $1', [id]), { code: '42501' })
    const updated = await db.query<{ favorite: boolean }>('update public.recipe_book_recipes set favorite = true where id = $1 returning favorite', [id])
    assert.equal(updated.rows[0].favorite, true)
    await assert.rejects(db.query('update public.recipe_book_recipes set servings = 0 where id = $1', [id]), { code: '23514' })

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userB])
    assert.equal((await db.query('select * from public.recipe_book_recipes')).rows.length, 0)
    assert.equal((await db.query('update public.recipe_book_recipes set title = $1 where id = $2 returning id', ['שינוי אסור', id])).rows.length, 0)
    assert.equal((await db.query('delete from public.recipe_book_recipes where id = $1 returning id', [id])).rows.length, 0)
    await assert.rejects(db.query(`insert into public.recipe_book_recipes
      (owner_id,title,ingredients,instructions) values ($1,'סלט',array['מלפפון'],array['קוצצים'])`, [userA]), { code: '42501' })

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userA])
    assert.equal((await db.query('delete from public.recipe_book_recipes where id = $1 returning id', [id])).rows.length, 1)
  } finally { await db.close() }
})
