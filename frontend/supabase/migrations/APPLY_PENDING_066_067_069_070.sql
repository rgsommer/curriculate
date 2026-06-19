-- ============================================================================
-- Campfire — pending migrations bundled for one paste (066, 067, 069, 070).
-- 068 is already applied; it is intentionally NOT included here.
-- Everything is idempotent (IF NOT EXISTS / CREATE OR REPLACE) — safe to re-run.
--
-- If your SQL editor complains about a "transaction block" on the ALTER TYPE
-- lines just below, run ONLY those three lines first, then run the rest.
-- ============================================================================


-- ── 069: new engagement_type enum values (tournament / pledge / raffle draw) ──
alter type engagement_type add value if not exists 'tournament';
alter type engagement_type add value if not exists 'pledge_drive';
alter type engagement_type add value if not exists 'raffle_draw';


-- ── 066: Raffle / prize-challenge voting + paid-entry helper ──
create table if not exists public.campfire_challenge_votes (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null references public.engagements on delete cascade,
  voter_user_id  uuid not null,
  response_id    uuid not null references public.responses on delete cascade,
  created_at     timestamptz not null default now(),
  unique (engagement_id, voter_user_id)
);
create index if not exists campfire_challenge_votes_eng_idx
  on public.campfire_challenge_votes (engagement_id);
alter table public.campfire_challenge_votes enable row level security;

drop policy if exists "voter manages own challenge vote" on public.campfire_challenge_votes;
create policy "voter manages own challenge vote"
  on public.campfire_challenge_votes for all
  using (voter_user_id = auth.uid())
  with check (voter_user_id = auth.uid());

create or replace function public.campfire_challenge_tallies(_eid uuid)
returns table (response_id uuid, votes bigint)
language sql security definer set search_path = public
as $$
  select v.response_id, count(*)::bigint as votes
  from public.campfire_challenge_votes v
  join public.responses r on r.id = v.response_id
  where v.engagement_id = _eid
    and v.voter_user_id <> r.user_id   -- no self-votes
  group by v.response_id;
$$;
grant execute on function public.campfire_challenge_tallies(uuid) to authenticated;

create or replace function public.campfire_my_paid_cents(_eid uuid)
returns bigint
language sql security definer set search_path = public
as $$
  select coalesce(sum(amount_cents), 0)::bigint
  from public.campfire_gift_contributions
  where engagement_id = _eid and user_id = auth.uid() and status = 'paid';
$$;
grant execute on function public.campfire_my_paid_cents(uuid) to authenticated;


-- ── 067: Pledge Drive columns + anonymized leaderboard ──
alter table public.campfire_gift_contributions
  add column if not exists pledge_per_unit_cents integer not null default 0;
alter table public.campfire_gift_contributions
  add column if not exists pledge_max_cents integer not null default 0;

create or replace function public.campfire_pledge_amounts(_eid uuid)
returns table (amount_cents integer, per_unit_cents integer)
language sql security definer set search_path = public
as $$
  select amount_cents, pledge_per_unit_cents
  from public.campfire_gift_contributions
  where engagement_id = _eid and status = 'paid'
  order by amount_cents desc
  limit 200;
$$;
grant execute on function public.campfire_pledge_amounts(uuid) to authenticated;


-- ── 070: revealed_at + trigger (powers the "Revealed!" today/yesterday box) ──
alter table public.engagements
  add column if not exists revealed_at timestamptz;

create or replace function public.set_revealed_at()
returns trigger language plpgsql
as $$
begin
  if new.status = 'revealed' and (old.status is distinct from 'revealed') then
    new.revealed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_revealed_at on public.engagements;
create trigger trg_set_revealed_at
  before update on public.engagements
  for each row execute function public.set_revealed_at();
