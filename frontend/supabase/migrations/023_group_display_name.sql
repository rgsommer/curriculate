-- 023_group_display_name.sql
-- Per-group display names: the same person can be "Dad" in Family and
-- "Mr. Sommer" in class. An override on the membership row; falls back to the
-- profile's global name when null.

alter table public.group_members
  add column if not exists display_name text;

-- Set/clear YOUR OWN name in a group. SECURITY DEFINER so it only ever touches
-- display_name on the caller's own membership row (no role escalation risk —
-- which a blanket UPDATE policy on group_members would allow).
create or replace function public.set_group_display_name(_group_id uuid, _name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.group_members
    set display_name = nullif(trim(_name), '')
    where group_id = _group_id and user_id = auth.uid();
end;
$$;
grant execute on function public.set_group_display_name(uuid, text) to authenticated, anon;
