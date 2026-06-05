-- 007_moderation.sql
-- Moderation: group admins can remove responses; members can report a response.

-- Group admins (host) or the engagement's creator can remove a response.
drop policy if exists "Admins can remove responses" on public.responses;
create policy "Admins can remove responses"
  on public.responses for delete
  using (
    exists (
      select 1 from public.engagements e
      where e.id = responses.engagement_id and e.creator_id = auth.uid()
    )
    or exists (
      select 1
      from public.engagements e
      join public.group_members gm on gm.group_id = e.group_id
      where e.id = responses.engagement_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

create table if not exists public.campfire_reports (
  id            uuid primary key default gen_random_uuid(),
  response_id   uuid references public.responses on delete cascade not null,
  engagement_id uuid references public.engagements on delete cascade not null,
  reporter_id   uuid references public.profiles not null,
  reason        text,
  created_at    timestamptz not null default now(),
  unique (response_id, reporter_id)
);

alter table public.campfire_reports enable row level security;

create index if not exists idx_campfire_reports_engagement
  on public.campfire_reports (engagement_id);

-- A member can file a report for a response in their group.
create policy "Members can report"
  on public.campfire_reports for insert
  with check (
    reporter_id = auth.uid()
    and exists (
      select 1 from public.engagements e
      where e.id = engagement_id and public.is_group_member(e.group_id)
    )
  );

-- Only group admins can see the reports.
create policy "Admins view reports"
  on public.campfire_reports for select
  using (
    exists (
      select 1
      from public.engagements e
      join public.group_members gm on gm.group_id = e.group_id
      where e.id = campfire_reports.engagement_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );
