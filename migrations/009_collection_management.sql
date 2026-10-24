alter table kitchen.import_items add column deleted_at timestamptz;
alter table kitchen.import_items add column trash_previous_status text;
alter table kitchen.recipes add column trash_previous_status text;
alter table kitchen.owner add column recovery_hashes text[] not null default '{}';
create index import_items_collection on kitchen.import_items(status,created_at desc,id);
