-- A single owner's append-only intake; it cannot publish recipes or approve categories.
create table kitchen.chat_import_grants (
  token_hash text primary key check(length(token_hash)=64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked boolean not null default false,
  uses integer not null default 0,
  check(expires_at>created_at and expires_at<=created_at+interval '1 hour')
);
create index chat_import_grants_expiry on kitchen.chat_import_grants(expires_at);
create table kitchen.chat_import_config (
  id smallint primary key default 1 check(id=1),
  drive jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table kitchen.chat_import_sources (
  source_key text primary key,
  provider text not null check(provider in ('drive','chat','file')),
  external_id text not null,
  filename text not null,
  digest text not null,
  media_id uuid not null references kitchen.media(id),
  created_at timestamptz not null default now()
);
create index chat_import_sources_external on kitchen.chat_import_sources(provider,external_id);
create index chat_import_sources_media on kitchen.chat_import_sources(media_id);
create table kitchen.chat_import_records (
  import_key text primary key,
  item_id uuid not null unique references kitchen.import_items(id),
  source_fingerprint text not null,
  recipe_index integer not null default 0 check(recipe_index between 0 and 99),
  payload_hash text not null,
  processor jsonb not null,
  source_keys text[] not null,
  created_at timestamptz not null default now(),
  unique(source_fingerprint,recipe_index)
);
