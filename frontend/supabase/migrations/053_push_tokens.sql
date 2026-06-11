-- 053_push_tokens.sql
-- Device push tokens from the native (Capacitor) app, so the digest/notify features
-- can reach a phone. One row per (user, device token). The send side (APNs/FCM) is
-- wired up separately; this just captures the tokens.
create table if not exists public.campfire_push_tokens (
  user_id    uuid not null references public.profiles on delete cascade,
  token      text not null,
  platform   text,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);
alter table public.campfire_push_tokens enable row level security;

drop policy if exists "Manage own push tokens" on public.campfire_push_tokens;
create policy "Manage own push tokens"
  on public.campfire_push_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
