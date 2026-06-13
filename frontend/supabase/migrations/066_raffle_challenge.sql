-- 066_raffle_challenge.sql
-- Raffle Challenge: a photo/video challenge whose chip-in pool goes to the WINNER
-- (decided by a one-vote-each group vote), not a preset recipient. The host marks
-- it raffle via engagement.config.raffle = { on, hostSplitPct, voteDays,
-- participationGate, voteClosesAt }. The pool uses the existing embedded gift_*
-- columns; the winner's email is written there at award time. No reveal of who
-- voted for whom — only the tallies matter.

create table if not exists public.campfire_challenge_votes (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null references public.engagements on delete cascade,
  voter_user_id  uuid not null,
  response_id    uuid not null references public.responses on delete cascade,
  created_at     timestamptz not null default now(),
  -- One vote per person per challenge (re-voting updates the row).
  unique (engagement_id, voter_user_id)
);
create index if not exists campfire_challenge_votes_eng_idx
  on public.campfire_challenge_votes (engagement_id);
alter table public.campfire_challenge_votes enable row level security;

-- A voter manages only their own vote; counts are read via the RPC below.
drop policy if exists "voter manages own challenge vote" on public.campfire_challenge_votes;
create policy "voter manages own challenge vote"
  on public.campfire_challenge_votes for all
  using (voter_user_id = auth.uid())
  with check (voter_user_id = auth.uid());

-- Per-entry tallies, readable by any member (security definer so it doesn't need a
-- broad SELECT policy on the votes table). The cron awards using the service role.
-- Self-votes never count — you can't vote for your own entry.
create or replace function public.campfire_challenge_tallies(_eid uuid)
returns table (response_id uuid, votes bigint)
language sql
security definer
set search_path = public
as $$
  select v.response_id, count(*)::bigint as votes
  from public.campfire_challenge_votes v
  join public.responses r on r.id = v.response_id
  where v.engagement_id = _eid
    and v.voter_user_id <> r.user_id   -- can't vote for your own entry
  group by v.response_id;
$$;
grant execute on function public.campfire_challenge_tallies(uuid) to authenticated;
