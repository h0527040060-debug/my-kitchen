alter table kitchen.import_items add column base_recipe_revision integer;
create table kitchen.category_images(id uuid primary key,category_id uuid not null references kitchen.categories(id),media_id uuid not null references kitchen.media(id),source text not null,created_at timestamptz not null default now());
create unique index assistant_job_unique on kitchen.assistant_messages(job_id);
