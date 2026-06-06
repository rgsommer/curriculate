-- 030_surprise_exclude.sql
-- "All Except" / surprise: exclude member(s) from an engagement — they can't see
-- it or be counted until the reveal, then everyone (including them) gets it.
-- e.g. a birthday card written by everyone except the birthday person.

alter table public.engagements
  add column if not exists excluded_user_ids uuid[] not null default '{}';

-- Hide the engagement from excluded members until it's revealed (the surprise).
drop policy if exists "Members can view group engagements" on public.engagements;
create policy "Members can view group engagements"
  on public.engagements for select
  using (
    group_id in (select group_id from public.group_members where user_id = auth.uid())
    and (launched_at is not null or creator_id = auth.uid())
    and (
      creator_id = auth.uid()
      or status = 'revealed'
      or not (auth.uid() = any(coalesce(excluded_user_ids, '{}')))
    )
  );

-- total_expected must ignore excluded members (they don't respond), or a sealed
-- engagement would wait forever on the surprise recipient.

-- (a) at creation
create or replace function public.set_engagement_total()
returns trigger language plpgsql as $$
begin
  if new.total_expected = 0 then
    new.total_expected := (
      select count(*) from public.group_members
      where group_id = new.group_id and role != 'spectator'
        and not (user_id = any(coalesce(new.excluded_user_ids, '{}')))
    );
  end if;
  return new;
end;
$$;

-- (b) when a member joins
create or replace function public.bump_total_expected()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.engagements e
    set total_expected = (
      select count(*) from public.group_members gm
      where gm.group_id = e.group_id
        and not (gm.user_id = any(coalesce(e.excluded_user_ids, '{}')))
    )
    where e.group_id = new.group_id and e.status = 'active';
  return new;
end;
$$;

-- (c) when a member leaves
create or replace function public.recount_total_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.engagements e
    set total_expected = (
      select count(*) from public.group_members gm
      where gm.group_id = e.group_id
        and not (gm.user_id = any(coalesce(e.excluded_user_ids, '{}')))
    )
    where e.group_id = old.group_id and e.status = 'active';
  return old;
end;
$$;
