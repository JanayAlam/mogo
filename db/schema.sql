-- Run once in the Supabase SQL editor. The Python runner's create_all() is a no-op when these exist.
create table if not exists runs (
  id          varchar(36) primary key default gen_random_uuid()::text,
  repo        varchar(200) not null,
  pr_url      varchar(500) not null,
  pr_number   integer not null,
  feature     text not null default '',
  llm_mode    varchar(20) not null default 'auto',
  dry_run     boolean not null default false,
  status      varchar(20) not null default 'queued',
  llm_used    varchar(100) not null default '',
  verdict     varchar(30) not null default '',
  result      json,
  review_url  varchar(500) not null default '',
  error       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists run_events (
  id      serial primary key,
  run_id  varchar(36) not null references runs(id) on delete cascade,
  ts      timestamptz not null default now(),
  level   varchar(10) not null default 'info',
  message text not null
);
create index if not exists ix_run_events_run_id on run_events(run_id);

-- Only the server (service connection string) talks to these tables; keep the public API closed.
alter table runs enable row level security;
alter table run_events enable row level security;
