-- 029_engagement_views.sql
-- Track who's looked at a revealed engagement (read receipts) so the host can
-- see who's seen the results.

create table if not exists public.campfire_engagement_views (
  engagement_id uuid not null references public.engagements on delete cascade,
  user_id       uuid not null references public.profiles on delete cascade,
  seen_at       timestamptz not null default now(),
  primary key (engagement_id, user_id)
);
alter table public.campfire_engagement_views enable row level security;

-- You record your own view, for an engagement in a group you're in.
drop policy if exists "Record own view" on public.campfire_engagement_views;
create policy "Record own view" on public.campfire_engagement_views
  for insert with check (
    user_id = auth.uid()
    and engagement_id in (
      select e.id from public.engagements e
      where e.group_id in (select group_id from public.group_members where user_id = auth.uid())
    )
  );

-- Anyone in the group can read the view list (so the host sees who's seen it).
drop policy if exists "Members see views" on public.campfire_engagement_views;
create policy "Members see views" on public.campfire_engagement_views
  for select using (
    engagement_id in (
      select e.id from public.engagements e
      where e.group_id in (select group_id from public.group_members where user_id = auth.uid())
    )
  );
