-- Additive schema: touches only recipe_book_* objects.
-- Apply to the project explicitly selected by the owner.
create table public.recipe_book_recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  category text not null default 'עיקריות'
    check (category in ('ארוחות בוקר', 'עיקריות', 'סלטים', 'מרקים', 'מאפים', 'קינוחים', 'אחר')),
  prep_minutes integer not null default 0 check (prep_minutes between 0 and 10080),
  cook_minutes integer not null default 0 check (cook_minutes between 0 and 10080),
  servings integer not null default 4 check (servings between 1 and 100),
  ingredients text[] not null,
  instructions text[] not null,
  image_url text check (image_url is null or
    (char_length(image_url) <= 2048 and image_url ~ '^https://[^[:space:]]+$')),
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipe_book_ingredients_valid check (
    cardinality(ingredients) between 1 and 100 and array_ndims(ingredients) = 1 and
    array_position(ingredients, null) is null and not ('' = any(ingredients)) and
    char_length(array_to_string(ingredients, E'\n')) <= 200000
  ),
  constraint recipe_book_instructions_valid check (
    cardinality(instructions) between 1 and 100 and array_ndims(instructions) = 1 and
    array_position(instructions, null) is null and not ('' = any(instructions)) and
    char_length(array_to_string(instructions, E'\n')) <= 200000
  )
);

create index recipe_book_owner_updated_idx
  on public.recipe_book_recipes (owner_id, updated_at desc, id);

alter table public.recipe_book_recipes enable row level security;

create policy recipe_book_select_own on public.recipe_book_recipes
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy recipe_book_insert_own on public.recipe_book_recipes
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy recipe_book_update_own on public.recipe_book_recipes
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy recipe_book_delete_own on public.recipe_book_recipes
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- Explicit grants support projects that do not auto-expose new tables.
revoke all on table public.recipe_book_recipes from public, anon, authenticated;
grant select, delete on table public.recipe_book_recipes to authenticated;
grant insert (owner_id, title, description, category, prep_minutes, cook_minutes,
  servings, ingredients, instructions, image_url, favorite)
  on public.recipe_book_recipes to authenticated;
grant update (title, description, category, prep_minutes, cook_minutes,
  servings, ingredients, instructions, image_url, favorite)
  on public.recipe_book_recipes to authenticated;

create function public.recipe_book_touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.recipe_book_touch_updated_at() from public, anon, authenticated;

create trigger recipe_book_updated_at
  before update on public.recipe_book_recipes
  for each row execute function public.recipe_book_touch_updated_at();

comment on table public.recipe_book_recipes is
  'Kort personal recipe book. Users can access only their own recipes through RLS.';
