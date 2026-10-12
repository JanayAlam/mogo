-- Real users: sign-in with GitHub through the Mogo GitHub App. A project belongs to one user; reviews are posted by
-- the App (mogo[bot]) on repos where that user installed it, with the user's own LLM.
-- Projects created before users existed have no owner and are deleted (with their repos, features and runs).
delete from runs;
delete from projects;

create table if not exists users (
  id                        varchar(36) primary key default gen_random_uuid()::text,
  github_id                 bigint not null unique, -- logins can be renamed, ids cannot
  login                     varchar(100) not null,
  name                      varchar(200) not null default '',
  avatar_url                varchar(500) not null default '',
  email                     varchar(320) not null default '',
  -- GitHub user-to-server token (lists the user's installations). AES-256-GCM with MOGO_SECRET_KEY, same format as
  -- repo_env, additional data "user:<id>:github_token" / "user:<id>:github_refresh".
  github_token_enc          text,
  github_token_expires_at   timestamptz,
  github_refresh_enc        text,
  github_refresh_expires_at timestamptz,
  -- The user's LLM: any OpenAI-compatible API. The key is optional (local servers); additional data "user:<id>:llm_api_key".
  llm_base_url              varchar(500) not null default '',
  llm_model                 varchar(200) not null default '',
  llm_api_key_enc           text,
  created_at                timestamptz not null default now(),
  last_login_at             timestamptz not null default now()
);

-- The cookie holds a random token; only its sha256 is stored.
create table if not exists sessions (
  token_hash char(64) primary key,
  user_id    varchar(36) not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists ix_sessions_user_id on sessions(user_id);

alter table projects add column if not exists owner_id varchar(36) references users(id) on delete cascade;
alter table projects alter column owner_id set not null;
create index if not exists ix_projects_owner_id on projects(owner_id);

-- The App installation that grants access to the repo. Null: Mogo was uninstalled or the repo removed from it.
alter table repos add column if not exists installation_id bigint;
create index if not exists ix_repos_installation_id on repos(installation_id);

alter table runs add column if not exists created_by varchar(36) references users(id) on delete set null;
-- The LLM is the project owner's, not a per-run choice.
alter table runs drop column if exists llm_mode;

alter table users enable row level security;
alter table sessions enable row level security;
