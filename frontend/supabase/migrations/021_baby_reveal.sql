-- 021_baby_reveal.sql
-- "Baby Reveal" activity: the host poses a question with set choices (default
-- Boy/Girl), members lock in a guess (sealed), and it auto-reveals on a set date
-- (sealed + hold_until_deadline). The host's real answer is kept secret in a
-- separate table until the reveal, then winners are highlighted.

alter type engagement_type add value if not exists 'baby_reveal';

-- The host's real answer, hidden from members until the engagement is revealed.
create table if not exists public.campfire_reveal_answers (
  engagement_id uuid primary key references public.engagements on delete cascade,
  answer        text not null,
  created_at    timestamptz not null default now()
);
alter table public.campfire_reveal_answers enable row level security;

-- The engagement creator (host) can set/change the secret answer.
drop policy if exists "Creator manages reveal answer" on public.campfire_reveal_answers;
create policy "Creator manages reveal answer" on public.campfire_reveal_answers
  for all using (
    exists (select 1 from public.engagements e
            where e.id = campfire_reveal_answers.engagement_id and e.creator_id = auth.uid())
  ) with check (
    exists (select 1 from public.engagements e
            where e.id = campfire_reveal_answers.engagement_id and e.creator_id = auth.uid())
  );

-- Everyone else in the group can read it only once the engagement is revealed.
drop policy if exists "Members see reveal answer after reveal" on public.campfire_reveal_answers;
create policy "Members see reveal answer after reveal" on public.campfire_reveal_answers
  for select using (
    exists (
      select 1 from public.engagements e
      where e.id = campfire_reveal_answers.engagement_id
        and e.status = 'revealed'
        and e.group_id in (select group_id from public.group_members where user_id = auth.uid())
    )
  );
