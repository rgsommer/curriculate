-- 060_member_start_gift.sql
-- Let ANY group member start a group chip-in toward a gift for one guest on an
-- engagement (e.g. a class-party Sign-up) — not just the host. A SECURITY DEFINER
-- RPC enables the gift after checking the caller is a member of the group; it
-- records who started it so they (or the host) can send it.
alter table public.engagements
  add column if not exists gift_initiated_by uuid references public.profiles;

create or replace function public.campfire_start_gift(
  _eid uuid,
  _email text,
  _name text default null,
  _currency text default 'usd'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare e record;
begin
  select * into e from public.engagements where id = _eid;
  if e is null then raise exception 'Engagement not found'; end if;
  if not exists (
    select 1 from public.group_members
    where group_id = e.group_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this group';
  end if;
  if coalesce(e.gift_enabled, false) then
    raise exception 'A chip-in is already running for this';
  end if;
  if _email is null or btrim(_email) = '' then
    raise exception 'A recipient email is required';
  end if;
  update public.engagements set
    gift_enabled = true,
    gift_recipient_email = btrim(_email),
    gift_recipient_name = nullif(btrim(coalesce(_name, '')), ''),
    gift_currency = coalesce(nullif(btrim(coalesce(_currency, '')), ''), 'usd'),
    gift_initiated_by = auth.uid()
  where id = _eid;
end;
$$;
grant execute on function public.campfire_start_gift(uuid, text, text, text) to authenticated;
