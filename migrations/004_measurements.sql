alter table kitchen.recipes add column measurement_config jsonb not null default '{"cup_ml":null,"packages":[]}';
alter table kitchen.recipe_versions add column measurement_config jsonb not null default '{"cup_ml":null,"packages":[]}';
alter table kitchen.cooking add column measurement_config jsonb not null default '{"cup_ml":null,"packages":[]}';
alter table kitchen.meal_items add column measurement_config jsonb not null default '{"cup_ml":null,"packages":[]}';
alter table kitchen.shopping_items add column assumptions text[] not null default '{}';
