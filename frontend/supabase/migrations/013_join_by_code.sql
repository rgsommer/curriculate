-- 013_join_by_code.sql
-- BUGFIX: invite-link joins were impossible for anyone not already in the group.
--
-- The groups SELECT policy (migration 002) only lets existing members or the
-- creator read a group row. But joinGroup() resolves the invite code by SELECTing
-- the group first — so a freshly-signed-in invitee got NULL back ("Invalid invite
-- code") and the membership insert never ran. This is exactly the "clicked the
-- email link, signed in with another Google account, didn't get joined" report.
--
-- Fix: a SECURITY DEFINER function that looks up the code and joins the CALLER,
-- bypassing RLS safely — it only ever inserts auth.uid(), never an arbitrary user.

create or replace function public.join_group_by_code(_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  gid uuid;
begin
  if auth.uid() is null then
    return null; -- must be signed in (incl. anonymous) to join
  end if;

  select id into gid
    from public.groups
    where upper(invite_code) = upper(trim(_code))
    limit 1;

  if gid is null then
    return null; -- no such code
  end if;

  insert into public.group_members (group_id, user_id, role)
    values (gid, auth.uid(), 'member')
    on conflict (group_id, user_id) do nothing; -- idempotent: re-join is a no-op

  return gid;
end;
$$;

grant execute on function public.join_group_by_code(text) to authenticated, anon;
