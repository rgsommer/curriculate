-- 028_admin_and_delete.sql
-- (1) Group admins (not just the creator) can edit the group.
-- (2) The creator can delete the group.
-- (3) Admins can promote/demote members (the creator always stays admin).

-- Admins or the creator can update the group (rename, settings).
drop policy if exists "Group creator can update group" on public.groups;
drop policy if exists "Admins update group" on public.groups;
create policy "Admins update group"
  on public.groups for update
  using ( public.is_group_admin(id) or creator_id = auth.uid() );

-- Only the creator (owner) can delete the whole group.
drop policy if exists "Creator can delete group" on public.groups;
create policy "Creator can delete group"
  on public.groups for delete
  using ( creator_id = auth.uid() );

-- Promote/demote a member. SECURITY DEFINER so role changes can't be self-applied
-- via a blanket policy; only a group admin may call it, and the creator can't be
-- demoted.
create or replace function public.set_member_role(_group_id uuid, _user_id uuid, _role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(_group_id) then
    raise exception 'Only an admin can change roles';
  end if;
  if _role not in ('admin', 'member') then
    raise exception 'Invalid role';
  end if;
  if _role <> 'admin' and exists (
    select 1 from public.groups g where g.id = _group_id and g.creator_id = _user_id
  ) then
    raise exception 'The group creator stays an admin';
  end if;
  update public.group_members
    set role = _role
    where group_id = _group_id and user_id = _user_id;
end;
$$;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
