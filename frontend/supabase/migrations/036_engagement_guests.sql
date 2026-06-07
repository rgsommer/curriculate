-- 036_engagement_guests.sql
-- Engagement-only guests. Someone invited to a SINGLE engagement (e.g. a birthday
-- card sent to friends who aren't family) can see and respond to JUST that one
-- engagement, WITHOUT becoming a member of the group. They never see the group,
-- its members, or its other engagements.
--
-- Rule enforced by the client: any invite link carrying ?e=<engagementId> joins
-- as a guest of that engagement; a plain group invite (no ?e=) joins as a member.

-- ────────────────────────────────────────────────────────────
-- GUEST TABLE
-- ────────────────────────────────────────────────────────────
create table if not exists public.engagement_guests (
  engagement_id uuid not null references public.engagements on delete cascade,
  user_id       uuid not null references public.profiles on delete cascade,
  joined_at     timestamptz not null default now(),
  primary key (engagement_id, user_id)
);
alter table public.engagement_guests enable row level security;

-- A guest can read their own guest rows (inserts go only through the RPC below).
drop policy if exists "Guests see own guest rows" on public.engagement_guests;
create policy "Guests see own guest rows"
  on public.engagement_guests for select
  using (user_id = auth.uid());

-- Is the current user a guest of this engagement? SECURITY DEFINER so it can be
-- referenced from other tables' policies without recursive RLS headaches.
create or replace function public.is_engagement_guest(_eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.engagement_guests
    where engagement_id = _eid and user_id = auth.uid()
  );
$$;
grant execute on function public.is_engagement_guest(uuid) to authenticated, anon;

-- Engagement-scoped invitations: a null engagement_id = a whole-group invite
-- (shown on the group page); a set value = a card guest invite (shown only on
-- that engagement, kept OUT of the group's invitation list).
alter table public.campfire_invitations
  add column if not exists engagement_id uuid references public.engagements on delete cascade;

-- Join an engagement as a guest (no group membership). Idempotent. If the caller
-- is already a group member, this is a no-op (they don't need a guest row).
-- _email (the address the invite was sent to, if any) lets us mark that
-- engagement-scoped invitation joined for the host's per-card tracking — without
-- touching the group's membership or its invitation list.
create or replace function public.join_engagement_as_guest(_eid uuid, _email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  gid uuid;
  st  text;
begin
  select group_id, status into gid, st from public.engagements where id = _eid;
  if gid is null then
    raise exception 'Engagement not found';
  end if;
  -- Only an open (active) or finished (revealed) engagement can be guest-joined —
  -- never a draft that hasn't launched.
  if st not in ('active', 'revealed') then
    raise exception 'This card is not open yet';
  end if;
  -- Already a full member → nothing to do, just route them in.
  if exists (
    select 1 from public.group_members where group_id = gid and user_id = auth.uid()
  ) then
    return gid;
  end if;
  insert into public.engagement_guests (engagement_id, user_id)
    values (_eid, auth.uid())
    on conflict do nothing;
  if _email is not null and length(trim(_email)) > 0 then
    update public.campfire_invitations
      set status = 'joined', joined_at = now()
      where engagement_id = _eid
        and lower(email) = lower(trim(_email))
        and status <> 'joined';
  end if;
  return gid;
end;
$$;
grant execute on function public.join_engagement_as_guest(uuid, text) to authenticated, anon;

-- ────────────────────────────────────────────────────────────
-- RLS: let guests see + respond to ONLY their engagement
-- (Additive policies — existing member policies are untouched. RLS is OR-ed.)
-- ────────────────────────────────────────────────────────────

-- See the engagement itself.
drop policy if exists "Guests can view their engagement" on public.engagements;
create policy "Guests can view their engagement"
  on public.engagements for select
  using (public.is_engagement_guest(id));

-- Submit a response while it's active.
drop policy if exists "Guests can submit responses" on public.responses;
create policy "Guests can submit responses"
  on public.responses for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.engagements e
      where e.id = engagement_id
        and e.status = 'active'
        and public.is_engagement_guest(e.id)
    )
  );

-- See everyone's responses once the card is revealed (own response already
-- visible via the existing "Sealed response visibility" policy).
drop policy if exists "Guests can view revealed responses" on public.responses;
create policy "Guests can view revealed responses"
  on public.responses for select
  using (
    engagement_id in (
      select id from public.engagements
      where status = 'revealed' and public.is_engagement_guest(id)
    )
  );

-- Reactions + comments on the revealed card (inserts already only check
-- user_id = auth.uid(), so guests can add their own; these add read access).
drop policy if exists "Guests can view reactions" on public.reactions;
create policy "Guests can view reactions"
  on public.reactions for select
  using (
    response_id in (
      select r.id from public.responses r
      join public.engagements e on e.id = r.engagement_id
      where e.status = 'revealed' and public.is_engagement_guest(e.id)
    )
  );

drop policy if exists "Guests can view comments" on public.comments;
create policy "Guests can view comments"
  on public.comments for select
  using (
    engagement_id in (
      select id from public.engagements
      where status = 'revealed' and public.is_engagement_guest(id)
    )
  );

-- Read receipts: a guest records their own view + can read the list for their card.
drop policy if exists "Guests record own view" on public.campfire_engagement_views;
create policy "Guests record own view"
  on public.campfire_engagement_views for insert
  with check (user_id = auth.uid() and public.is_engagement_guest(engagement_id));

drop policy if exists "Guests see views" on public.campfire_engagement_views;
create policy "Guests see views"
  on public.campfire_engagement_views for select
  using (public.is_engagement_guest(engagement_id));

-- ────────────────────────────────────────────────────────────
-- total_expected must count engagement guests too, so "X of Y signed" is right.
-- Formula everywhere: non-excluded group members + that engagement's guests.
-- ────────────────────────────────────────────────────────────

-- (a) when a member joins (recompute all active engagements in the group)
create or replace function public.bump_total_expected()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.engagements e
    set total_expected = (
      select count(*) from public.group_members gm
      where gm.group_id = e.group_id
        and not (gm.user_id = any(coalesce(e.excluded_user_ids, '{}')))
    ) + (
      select count(*) from public.engagement_guests eg where eg.engagement_id = e.id
    )
    where e.group_id = new.group_id and e.status = 'active';
  return new;
end;
$$;

-- (b) when a member leaves
create or replace function public.recount_total_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.engagements e
    set total_expected = (
      select count(*) from public.group_members gm
      where gm.group_id = e.group_id
        and not (gm.user_id = any(coalesce(e.excluded_user_ids, '{}')))
    ) + (
      select count(*) from public.engagement_guests eg where eg.engagement_id = e.id
    )
    where e.group_id = old.group_id and e.status = 'active';
  return old;
end;
$$;

-- (c) when a guest joins this engagement → bump just this one's count
create or replace function public.bump_total_on_guest()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.engagements e
    set total_expected = (
      select count(*) from public.group_members gm
      where gm.group_id = e.group_id
        and not (gm.user_id = any(coalesce(e.excluded_user_ids, '{}')))
    ) + (
      select count(*) from public.engagement_guests eg where eg.engagement_id = e.id
    )
    where e.id = new.engagement_id and e.status = 'active';
  return new;
end;
$$;

drop trigger if exists on_guest_join_bump on public.engagement_guests;
create trigger on_guest_join_bump
  after insert on public.engagement_guests
  for each row execute procedure public.bump_total_on_guest();
