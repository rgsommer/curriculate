-- 051_group_response_digest.sql
-- A per-group switch for the daily "new responses" digest. When on (the default),
-- members get one email a day summarizing new responses across their groups. The
-- host can turn it off for a group to keep it quiet.
alter table public.groups
  add column if not exists notify_on_response boolean not null default true;
