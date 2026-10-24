-- Match the ILIKE queries used by Hebrew name, ingredient and note search.
-- pg_trgm is trusted: the dedicated database owner can install it without
-- cluster administration. An existing provider installation keeps its schema.
create extension if not exists pg_trgm with schema kitchen;
do $migration$
declare extension_schema text;
begin
  select n.nspname into strict extension_schema
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    where e.extname='pg_trgm';
  execute format('create index if not exists recipes_search_substring on kitchen.recipes using gin (search_text %I.gin_trgm_ops)', extension_schema);
end
$migration$;
drop index if exists kitchen.recipes_search;
