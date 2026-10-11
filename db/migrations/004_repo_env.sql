-- One environment list per repo: repo_secrets becomes repo_env with a `sensitive` flag.
-- Sensitive values: AES-256-GCM ciphertext in value_enc (write-only in the UI). Others: plain text in value, as the
-- old repos.config.env was. The plain values of repos.config.env move here; a secret with the same name wins.
alter table if exists repo_secrets rename to repo_env;

alter table repo_env add column if not exists sensitive boolean not null default true;
alter table repo_env add column if not exists value text;
alter table repo_env alter column value_enc drop not null;

insert into repo_env (repo_id, name, sensitive, value)
select r.id, e.key, false, e.value
from repos r, json_each_text(coalesce(r.config -> 'env', '{}'::json)) e
where e.key ~ '^[A-Za-z_][A-Za-z0-9_]*$' and e.value <> ''
on conflict (repo_id, name) do nothing;

update repos set config = (config::jsonb - 'env')::json where config::jsonb ? 'env';

alter table repo_env drop constraint if exists repo_env_one_value;
alter table repo_env add constraint repo_env_one_value check (
  (sensitive and value_enc is not null and value is null) or (not sensitive and value is not null and value_enc is null)
);

-- Settings the runner read from the source branch (package.json, lockfile, .env.example), offered in the UI.
alter table repo_profiles add column if not exists suggestions json;
