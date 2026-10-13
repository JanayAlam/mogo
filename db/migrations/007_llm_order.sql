-- LLM connections form an ordered fallback chain: a run tries the user's switched-on connections by `position`, and
-- moves to the next one when a connection fails. "Several active" replaces "one active".
alter table llm_connections add column if not exists position integer not null default 0;
drop index if exists ux_llm_connections_one_active;

-- Keep the order the cards had (oldest first), starting at 1 for each user.
update llm_connections c
set position = r.n
from (
  select id, row_number() over (partition by user_id order by created_at, id) as n from llm_connections
) r
where c.id = r.id and c.position = 0;

create index if not exists ix_llm_connections_user_position on llm_connections(user_id, position);
