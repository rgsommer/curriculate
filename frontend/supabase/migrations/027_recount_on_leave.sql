-- 027_recount_on_leave.sql
-- When a member leaves a group, drop total_expected on its active engagements to
-- the new member count — otherwise a sealed engagement could wait forever on
-- someone who's no longer in the group. (Mirror of the join-bump trigger.)

create or replace function public.recount_total_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.engagements
    set total_expected = (
      select count(*) from public.group_members where group_id = old.group_id
    )
    where group_id = old.group_id and status = 'active';
  return old;
end;
$$;

drop trigger if exists on_member_leave_recount on public.group_members;
create trigger on_member_leave_recount
  after delete on public.group_members
  for each row execute procedure public.recount_total_on_leave();
