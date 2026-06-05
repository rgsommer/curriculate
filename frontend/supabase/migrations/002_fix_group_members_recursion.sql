-- 002_fix_group_members_recursion.sql
--
-- Fixes: "infinite recursion detected in policy for relation group_members".
--
-- The original policies SELECT from group_members *inside* group_members' own
-- RLS policy (and the groups SELECT policy references it too). Evaluating the
-- policy re-triggers the policy, forever — Postgres aborts with a recursion
-- error. The standard Supabase fix is to check membership through a
-- SECURITY DEFINER function: it is owned by a role that bypasses RLS, so the
-- inner lookup does not re-enter the policy.

create or replace function public.is_group_member(_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = _group_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = _group_id and user_id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_group_member(uuid) to anon, authenticated;
grant execute on function public.is_group_admin(uuid)  to anon, authenticated;

-- group_members: members can see fellow members (was self-recursive)
drop policy if exists "Members can see fellow members" on public.group_members;
create policy "Members can see fellow members"
  on public.group_members for select
  using ( public.is_group_member(group_id) );

-- group_members: admins can remove members, users can leave (was self-recursive)
drop policy if exists "Admins can remove members" on public.group_members;
create policy "Admins can remove members"
  on public.group_members for delete
  using ( public.is_group_admin(group_id) or auth.uid() = user_id );

-- groups: members can view their groups (referenced group_members directly)
drop policy if exists "Members can view their groups" on public.groups;
create policy "Members can view their groups"
  on public.groups for select
  using ( public.is_group_member(id) or creator_id = auth.uid() );
