-- 047_response_anonymous.sql
-- When a person shares a Care check-in with the group, they may also choose to
-- share it ANONYMOUSLY — the group sees the response but not who wrote it. Per the
-- product decision, the host (shepherd) still sees the author, so this is purely a
-- UI-level mask (the row stays shared via share_to_group=true and user_id is intact,
-- exactly like the existing is_blind / anonymous-replies pattern). No RLS change.
--
--   share_to_group=false           → private to the host
--   share_to_group=true, anonymous=false → shared, with your name
--   share_to_group=true, anonymous=true  → shared, group sees "Anonymous" (host sees you)

alter table public.responses
  add column if not exists anonymous boolean not null default false;
