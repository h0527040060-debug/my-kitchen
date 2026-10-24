alter table kitchen.import_items add column scan_generation integer not null default 1;
create table kitchen.meal_suggestion_acceptances(job_id uuid primary key references kitchen.jobs(id),meal_id uuid not null references kitchen.meals(id),created_at timestamptz not null default now());
