alter table kitchen.recipes add column field_sources jsonb not null default '{}';
alter table kitchen.recipe_versions add column field_sources jsonb not null default '{}';
alter table kitchen.import_items add column field_sources jsonb not null default '{}';
alter table kitchen.cooking add column field_sources jsonb not null default '{}';
