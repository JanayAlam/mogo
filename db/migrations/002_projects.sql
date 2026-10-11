-- Projects, repos (settings in the database), features, repo profiles.

create table if not exists projects (
  id          varchar(36) primary key default gen_random_uuid()::text,
  name        varchar(200) not null,
  description text not null default '',
  settings    json not null default '{}',
  created_at  timestamptz not null default now()
);

-- `config` holds the run settings (setup, gates, start, env, ...). Never secret values.
create table if not exists repos (
  id             varchar(36) primary key default gen_random_uuid()::text,
  project_id     varchar(36) not null references projects(id) on delete cascade,
  full_name      varchar(200) not null,
  role           varchar(100) not null default '',
  default_branch varchar(200) not null default 'main',
  config         json not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (project_id, full_name)
);
create index if not exists ix_repos_project_id on repos(project_id);

create table if not exists repo_profiles (
  repo_id    varchar(36) primary key references repos(id) on delete cascade,
  main_sha   varchar(64) not null default '',
  structure  json,
  type_index json,
  summary    text not null default '',
  error      text not null default '',
  built_at   timestamptz not null default now()
);

create table if not exists features (
  id          varchar(36) primary key default gen_random_uuid()::text,
  project_id  varchar(36) not null references projects(id) on delete cascade,
  title       varchar(300) not null,
  description text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ix_features_project_id on features(project_id);

create table if not exists feature_repos (
  id           varchar(36) primary key default gen_random_uuid()::text,
  feature_id   varchar(36) not null references features(id) on delete cascade,
  repo_id      varchar(36) not null references repos(id) on delete cascade,
  pr_url       varchar(500) not null,
  pr_number    integer not null,
  requirements text not null default '',
  unique (feature_id, repo_id)
);
create index if not exists ix_feature_repos_feature_id on feature_repos(feature_id);
create index if not exists ix_feature_repos_repo_id on feature_repos(repo_id);

-- Added after the first draft of this file; harmless when the column exists.
alter table repo_profiles add column if not exists error text not null default '';

alter table runs add column if not exists feature_repo_id varchar(36) references feature_repos(id) on delete cascade;
create index if not exists ix_runs_feature_repo_id on runs(feature_repo_id);

alter table projects enable row level security;
alter table repos enable row level security;
alter table repo_profiles enable row level security;
alter table features enable row level security;
alter table feature_repos enable row level security;
