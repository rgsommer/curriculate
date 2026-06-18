-- 072_reveal_seen.sql
-- Per-user "I've already seen this reveal" tracking for the dashboard "Revealed!"
-- box. It used to live in localStorage (per device), so dismissing a reveal on one
-- device left it showing on every other device. Storing it per user makes "seen"
-- follow the person across all their devices: appears once, then done.

create table if not exists public.campfire_reveal_seen (
  user_id uuid not null references auth.users(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, engagement_id)
);

alter table public.campfire_reveal_seen enable row level security;

-- A user can only see and manage their own seen-markers.
drop policy if exists "Users manage own reveal-seen" on public.campfire_reveal_seen;
create policy "Users manage own reveal-seen" on public.campfire_reveal_seen
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
