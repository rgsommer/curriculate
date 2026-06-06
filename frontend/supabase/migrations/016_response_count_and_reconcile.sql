-- 016_response_count_and_reconcile.sql
-- Fixes "1/1 responded" when really 2 people responded, and engagements that
-- stay sealed forever because total_expected was stale.

-- 1) TRUE response count for the progress bar. The "Sealed response visibility"
--    policy hides other people's responses until the reveal, so a client-side
--    COUNT only sees the viewer's own — the bar reads "1/N" for everyone. This
--    SECURITY DEFINER function returns just the number (no response contents),
--    so progress is meaningful before the reveal without breaking the secrecy.
create or replace function public.engagement_response_count(_eid uuid)
returns int language sql security definer stable set search_path = public as $$
  select count(*)::int from public.responses where engagement_id = _eid;
$$;
grant execute on function public.engagement_response_count(uuid) to authenticated, anon;

-- 2) Keep total_expected tracking the member count as people join (re-create the
--    migration-009 trigger in case it was never applied — that's what left
--    total_expected at 1 after a second person joined).
create or replace function public.bump_total_expected()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.engagements
    set total_expected = (
      select count(*) from public.group_members where group_id = new.group_id
    )
    where group_id = new.group_id and status = 'active';
  return new;
end;
$$;
drop trigger if exists on_member_join_bump on public.group_members;
create trigger on_member_join_bump
  after insert on public.group_members
  for each row execute procedure public.bump_total_expected();

-- 3) Reconcile total_expected for existing ACTIVE engagements to the current
--    member count (fixes ones created while the group was smaller).
update public.engagements e
  set total_expected = (
    select count(*) from public.group_members gm where gm.group_id = e.group_id
  )
  where e.status = 'active';

-- 4) Unstick: reveal any active engagement that is actually complete now
--    (mirrors check_all_responded — same reveal modes + the >=2 guard).
update public.engagements e
  set status = 'revealed'
  where e.status = 'active'
    and e.reveal in ('sealed', 'as_they_come', 'instant', 'first_in')
    and e.total_expected >= 2
    and (select count(*) from public.responses r where r.engagement_id = e.id) >= e.total_expected;
