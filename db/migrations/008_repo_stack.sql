-- A repo's stack is one id (repos.config.stack: nodejs, express, nestjs, nextjs, python, fastapi, docker; see
-- web/src/lib/stack.ts). The first version of this setting kept a language plus a list of frameworks: convert it.
update repos
set config = (
  (config::jsonb - 'language' - 'frameworks') || jsonb_build_object('stack',
    case
      when config::jsonb ->> 'language' = 'typescript' and (config::jsonb -> 'frameworks') ? 'nextjs' then 'nextjs'
      when config::jsonb ->> 'language' = 'typescript' and (config::jsonb -> 'frameworks') ? 'express' then 'express'
      when config::jsonb ->> 'language' = 'typescript' then 'nodejs'
      when config::jsonb ->> 'language' = 'python' and (config::jsonb -> 'frameworks') ? 'fastapi' then 'fastapi'
      when config::jsonb ->> 'language' = 'python' then 'python'
      else ''
    end
  )
)::json
where (config::jsonb ? 'language' or config::jsonb ? 'frameworks') and not (config::jsonb ? 'stack');

-- Profiles built meanwhile suggested the old shape ({language, frameworks}); the next learn suggests the new one.
update repo_profiles
set suggestions = (suggestions::jsonb - 'stack')::json
where suggestions is not null and jsonb_typeof(suggestions::jsonb -> 'stack') = 'object';
