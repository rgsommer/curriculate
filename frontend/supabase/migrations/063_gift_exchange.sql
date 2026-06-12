-- 063_gift_exchange.sql
-- Sign-up gift exchange (Secret Santa). The host enables it on the engagement
-- (config.giftex = { on, byGender, assign }). Assignments — who buys for whom —
-- are the ONLY secret part; everything else (slots, RSVP, when/where) stays live.
--
-- Each buyer can read ONLY their own assignment (RLS), so it's a true secret.
-- The host generates assignments via a SECURITY DEFINER RPC (server-side random),
-- and can later "reveal" the full mapping by snapshotting it into engagement.config
-- (readable by everyone) — e.g. at the party.

create table if not exists public.campfire_giftex_assignments (
  id                uuid primary key default gen_random_uuid(),
  engagement_id     uuid not null references public.engagements on delete cascade,
  buyer_user_id     uuid not null,
  recipient_user_id uuid,            -- "person" mode: who they buy for
  buy_for_gender    text,            -- "gender" mode: which gender to buy for
  created_at        timestamptz not null default now(),
  unique (engagement_id, buyer_user_id)
);
create index if not exists campfire_giftex_eng_idx
  on public.campfire_giftex_assignments (engagement_id);
alter table public.campfire_giftex_assignments enable row level security;

-- A buyer may read only their own assignment. Writes happen via the RPCs below.
drop policy if exists "buyer sees own giftex assignment" on public.campfire_giftex_assignments;
create policy "buyer sees own giftex assignment"
  on public.campfire_giftex_assignments for select
  using (buyer_user_id = auth.uid());

-- Generate assignments for everyone who RSVP'd "yes". Creator only.
--   _mode = 'person' → a single random cycle (everyone buys for the next person;
--                      nobody gets themselves).
--   _mode = 'gender' → each buyer gets a gender to shop for, drawn from the
--                      attendees' own genders (so totals match the headcount).
create or replace function public.campfire_giftex_assign(_eid uuid, _mode text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  buyers uuid[];
  genders text[];
  n int;
  i int;
begin
  select * into e from public.engagements where id = _eid;
  if e is null then raise exception 'Engagement not found'; end if;
  if e.creator_id <> auth.uid() then raise exception 'Only the host can assign'; end if;

  -- Everyone who RSVP'd yes (distinct, real members), in random order.
  select array_agg(user_id order by random())
    into buyers
  from (
    select distinct user_id
    from public.responses
    where engagement_id = _eid
      and (content->>'attending') = 'yes'
      and user_id is not null
  ) p;

  n := coalesce(array_length(buyers, 1), 0);
  if n < 2 then
    raise exception 'Need at least 2 people who RSVP''d yes';
  end if;

  delete from public.campfire_giftex_assignments where engagement_id = _eid;

  if _mode = 'gender' then
    -- A shuffled multiset of the attendees' genders (missing → 'either').
    select array_agg(g order by random()) into genders
    from (
      select coalesce(nullif(btrim(content->>'gender'), ''), 'either') as g
      from public.responses
      where engagement_id = _eid
        and (content->>'attending') = 'yes'
        and user_id is not null
    ) x;
    for i in 1..n loop
      insert into public.campfire_giftex_assignments
        (engagement_id, buyer_user_id, buy_for_gender)
      values (_eid, buyers[i], genders[i]);
    end loop;
  else
    -- 'person' (default): random cycle — buyer i buys for the next in the ring.
    for i in 1..n loop
      insert into public.campfire_giftex_assignments
        (engagement_id, buyer_user_id, recipient_user_id)
      values (_eid, buyers[i], buyers[(i % n) + 1]);
    end loop;
  end if;

  return n;
end;
$$;
grant execute on function public.campfire_giftex_assign(uuid, text) to authenticated;

-- Reveal the full mapping (creator only): snapshot it into config so EVERY member
-- can see who bought for whom — e.g. at the party. Names are resolved client-side.
create or replace function public.campfire_giftex_reveal(_eid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare e record;
begin
  select * into e from public.engagements where id = _eid;
  if e is null then raise exception 'Engagement not found'; end if;
  if e.creator_id <> auth.uid() then raise exception 'Only the host can reveal'; end if;
  update public.engagements
  set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
        'giftexRevealedAt', now(),
        'giftexReveal', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'buyer', buyer_user_id,
            'recipient', recipient_user_id,
            'gender', buy_for_gender
          )), '[]'::jsonb)
          from public.campfire_giftex_assignments
          where engagement_id = _eid
        )
      )
  where id = _eid;
end;
$$;
grant execute on function public.campfire_giftex_reveal(uuid) to authenticated;
