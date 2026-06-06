-- 020_wait_for_all_invited.sql
-- New reveal-timing option: wait until everyone INVITED (not just the members
-- who've already joined) has joined AND responded before revealing. The deadline
-- cron still acts as a backstop so it can't freeze if someone never joins.

alter table public.engagements
  add column if not exists wait_for_all_invited boolean not null default false;

-- Member-safe count of still-pending invites for a group (number only, no emails),
-- so the progress bar can show the full expected count to every member.
create or replace function public.pending_invite_count(_gid uuid)
returns int language sql security definer stable set search_path = public as $$
  select case when exists (
    select 1 from public.group_members where group_id = _gid and user_id = auth.uid()
  ) then (
    select count(*)::int from public.campfire_invitations
    where group_id = _gid and status = 'pending'
  ) else 0 end;
$$;
grant execute on function public.pending_invite_count(uuid) to authenticated, anon;

-- Reveal logic: when wait_for_all_invited is on, the bar to clear is
-- (members + still-pending invites) — i.e. everyone invited has joined AND
-- responded. (Responses can only come from members, so this only completes once
-- nobody is still pending and all of them have answered.)
create or replace function public.check_all_responded()
returns trigger language plpgsql security definer as $$
declare
  eng record;
  response_count int;
  expected int;
begin
  select * into eng from public.engagements where id = new.engagement_id;
  select count(*) into response_count
    from public.responses where engagement_id = new.engagement_id;

  expected := eng.total_expected;
  if coalesce(eng.wait_for_all_invited, false) then
    expected := (select count(*) from public.group_members where group_id = eng.group_id)
              + (select count(*) from public.campfire_invitations
                   where group_id = eng.group_id and status = 'pending');
  end if;

  if response_count >= expected
     and expected >= 2
     and not coalesce(eng.hold_until_deadline, false) then
    if eng.reveal in ('sealed', 'as_they_come', 'instant', 'first_in') then
      update public.engagements set status = 'revealed' where id = new.engagement_id;
    end if;
  end if;
  return new;
end;
$$;
