-- 052_group_host_notify.sql
-- A host-only daily digest, separate from the member digest (notify_on_response).
-- When on (the default), the group's creator gets a recap of EVERYTHING that
-- happened in the group that day — new responses, new members, new activities —
-- even if they've turned the member digest off to keep the group quiet.
alter table public.groups
  add column if not exists notify_host boolean not null default true;
