-- 035_admin_name_member.sql
-- Let a group admin set another member's per-group display name (e.g. tidy up a
-- guest's name, or give a kid a clear class name). SECURITY DEFINER so only an
-- admin (or the member themselves) can do it, and only the name changes.

create or replace function public.set_member_display_name(
  _group_id uuid, _user_id uuid, _name text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(_group_id) and auth.uid() <> _user_id then
    raise exception 'Only an admin or the member can set this name';
  end if;
  update public.group_members
    set display_name = nullif(trim(_name), '')
    where group_id = _group_id and user_id = _user_id;
end;
$$;
grant execute on function public.set_member_display_name(uuid, uuid, text) to authenticated, anon;
