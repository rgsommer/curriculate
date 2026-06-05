-- 004_ratings.sql
-- Per-member ratings of each response after reveal (drives the winner).

create table if not exists public.campfire_ratings (
  id            uuid primary key default gen_random_uuid(),
  response_id   uuid references public.responses on delete cascade not null,
  engagement_id uuid references public.engagements on delete cascade not null,
  rater_id      uuid references public.profiles not null,
  score         int not null check (score between 1 and 5),
  created_at    timestamptz not null default now(),
  unique (response_id, rater_id)
);

alter table public.campfire_ratings enable row level security;

create index if not exists idx_campfire_ratings_engagement
  on public.campfire_ratings (engagement_id);

create policy "Members view ratings"
  on public.campfire_ratings for select
  using (
    exists (
      select 1 from public.engagements e
      where e.id = campfire_ratings.engagement_id
        and public.is_group_member(e.group_id)
    )
  );

create policy "Members add ratings"
  on public.campfire_ratings for insert
  with check (
    rater_id = auth.uid()
    and exists (
      select 1 from public.engagements e
      where e.id = engagement_id
        and e.status = 'revealed'
        and public.is_group_member(e.group_id)
    )
  );

create policy "Members update own ratings"
  on public.campfire_ratings for update
  using ( rater_id = auth.uid() )
  with check ( rater_id = auth.uid() );
