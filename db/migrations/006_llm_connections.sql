-- Several LLM connections per user instead of the single users.llm_* triple. A connection is switched on or off;
-- at most one is active per user, and the user's runs use it.
-- The key is AES-256-GCM like before, additional data "user:<user id>:llm_api_key" (so keys migrate as they are).
create table if not exists llm_connections (
  id          varchar(36) primary key default gen_random_uuid()::text,
  user_id     varchar(36) not null references users(id) on delete cascade,
  provider    varchar(20) not null check (provider in ('openai', 'anthropic', 'deepseek', 'openrouter', 'custom')),
  name        varchar(100) not null,
  base_url    varchar(500) not null,
  model       varchar(200) not null,
  api_key_enc text,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ix_llm_connections_user_id on llm_connections(user_id);
create unique index if not exists ux_llm_connections_one_active on llm_connections(user_id) where active;

-- The LLM each user had set up becomes their active connection (the provider is guessed from the URL). Skipped when
-- the old columns are already gone. No percent signs in this file: the migrator hands it to psycopg as it is.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'users' and column_name = 'llm_base_url') then
    insert into llm_connections (user_id, provider, name, base_url, model, api_key_enc, active)
    select id,
           case
             when starts_with(llm_base_url, 'https://api.openai.com/') then 'openai'
             when starts_with(llm_base_url, 'https://api.anthropic.com/') then 'anthropic'
             when starts_with(llm_base_url, 'https://api.deepseek.com') then 'deepseek'
             when starts_with(llm_base_url, 'https://openrouter.ai/') then 'openrouter'
             else 'custom'
           end,
           'Migrated', llm_base_url, llm_model, llm_api_key_enc, true
    from users
    where llm_base_url <> '' and llm_model <> ''
      and not exists (select 1 from llm_connections c where c.user_id = users.id);
  end if;
end $$;

alter table users drop column if exists llm_base_url;
alter table users drop column if exists llm_model;
alter table users drop column if exists llm_api_key_enc;

alter table llm_connections enable row level security;
