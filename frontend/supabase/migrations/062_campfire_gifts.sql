-- 062_campfire_gifts.sql
-- Sign-up chip-ins move into their own table so an engagement can have MORE THAN
-- ONE (e.g. several people each start a gift for a different guest). Each member
-- may start at most one per engagement; the host (engagement creator) is exempt.
--
-- Birthday/celebration CARD gifts keep their embedded engagements.gift_* columns
-- (one card = one recipient, auto-issued on reveal) — those are untouched here.

create table if not exists public.campfire_gifts (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references public.engagements on delete cascade,
  initiated_by    uuid references public.profiles,
  recipient_email text not null,
  recipient_name  text,
  currency        text not null default 'usd',
  -- The recipient(s) this chip-in is a surprise for — they can't see the gift.
  hidden_from     uuid[] not null default '{}',
  issued_at       timestamptz,
  order_id        text,
  created_at      timestamptz not null default now()
);
create index if not exists campfire_gifts_eng_idx
  on public.campfire_gifts (engagement_id);
alter table public.campfire_gifts enable row level security;

-- Group members may READ the gifts on an engagement they belong to — except a gift
-- that's a surprise for them. Writes happen only through the SECURITY DEFINER RPCs
-- below / the service-role server routes, so there's no insert/update policy.
drop policy if exists "Members see engagement gifts" on public.campfire_gifts;
create policy "Members see engagement gifts"
  on public.campfire_gifts for select
  using (
    exists (
      select 1 from public.engagements e
      where e.id = campfire_gifts.engagement_id
        and e.group_id in (
              select group_id from public.group_members where user_id = auth.uid()
            )
    )
    and not (auth.uid() = any (coalesce(hidden_from, '{}')))
  );

-- Contributions point at a specific gift (null for legacy card gifts, which still
-- key off engagement_id).
alter table public.campfire_gift_contributions
  add column if not exists gift_id uuid references public.campfire_gifts on delete cascade;
create index if not exists campfire_gift_contributions_gift_idx
  on public.campfire_gift_contributions (gift_id);

-- Per-gift running totals (paid only). SECURITY DEFINER so a non-member guest who
-- chipped in can still see the pool; excludes gifts hidden from the caller.
create or replace function public.gift_summaries_for_engagement(_eid uuid)
returns table (gift_id uuid, total_cents int, contributors int)
language sql security definer stable set search_path = public as $$
  select c.gift_id,
         coalesce(sum(c.amount_cents), 0)::int as total_cents,
         count(*)::int as contributors
  from public.campfire_gift_contributions c
  join public.campfire_gifts g on g.id = c.gift_id
  where g.engagement_id = _eid
    and c.status = 'paid'
    and not (auth.uid() = any (coalesce(g.hidden_from, '{}')))
  group by c.gift_id;
$$;
grant execute on function public.gift_summaries_for_engagement(uuid) to authenticated, anon;

-- Start a chip-in: any group member may, but only ONE per engagement (the host is
-- exempt). Returns the new gift id.
drop function if exists public.campfire_start_gift(uuid, text, text, text, uuid);
create or replace function public.campfire_start_gift(
  _eid uuid,
  _email text,
  _name text default null,
  _currency text default 'usd',
  _surprise_uid uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  gid uuid;
begin
  select * into e from public.engagements where id = _eid;
  if e is null then raise exception 'Engagement not found'; end if;
  if not exists (
    select 1 from public.group_members
    where group_id = e.group_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this group';
  end if;
  if _email is null or btrim(_email) = '' then
    raise exception 'A recipient email is required';
  end if;
  -- One chip-in per member per engagement — host (creator) exempt.
  if auth.uid() <> e.creator_id and exists (
    select 1 from public.campfire_gifts
    where engagement_id = _eid and initiated_by = auth.uid()
  ) then
    raise exception 'You already started a chip-in for this — only one each';
  end if;
  insert into public.campfire_gifts (
    engagement_id, initiated_by, recipient_email, recipient_name, currency, hidden_from
  ) values (
    _eid,
    auth.uid(),
    btrim(_email),
    nullif(btrim(coalesce(_name, '')), ''),
    coalesce(nullif(btrim(coalesce(_currency, '')), ''), 'usd'),
    case when _surprise_uid is not null then array[_surprise_uid]::uuid[] else '{}'::uuid[] end
  )
  returning id into gid;
  return gid;
end;
$$;
grant execute on function public.campfire_start_gift(uuid, text, text, text, uuid) to authenticated;
