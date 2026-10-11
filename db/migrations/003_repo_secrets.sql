-- Per-repo secrets entered in the web app. Values are AES-256-GCM ciphertext (key: MOGO_SECRET_KEY, held by the web
-- app and the runner only), bound to their repo and name. The web app never reads them back.
create table if not exists repo_secrets (
  repo_id    varchar(36) not null references repos(id) on delete cascade,
  name       varchar(200) not null,
  value_enc  text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (repo_id, name)
);

alter table repo_secrets enable row level security;
