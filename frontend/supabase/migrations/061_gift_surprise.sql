-- 061_gift_surprise.sql
-- "All Except" for a group chip-in: the gift recipient is surprised. Unlike
-- excluded_user_ids (which hides the WHOLE engagement via RLS), a Sign-up's
-- recipient should still see and join the sign-up — they just shouldn't see the
-- chip-in. So we hide only the gift section from them via gift_hidden_from.
alter table public.engagements
  add column if not exists gift_hidden_from uuid[] not null default '{}';

-- Replace the member-start-gift RPC (from 060) with an optional surprise target.
drop function if exists public.campfire_start_gift(uuid, text, text, text);

create or replace function public.campfire_start_gift(
  _eid uuid,
  _email text,
  _name text default null,
  _currency text default 'usd',
  _surprise_uid uuid default null
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
    gift_initiated_by = auth.uid(),
    -- Hide the chip-in from the recipient (if they're a group member) so it's a
    -- surprise — they keep full access to the sign-up itself.
    gift_hidden_from = case
      when _surprise_uid is not null then array[_surprise_uid]::uuid[]
      else '{}'::uuid[]
    end
  where id = _eid;
end;
$$;
grant execute on function public.campfire_start_gift(uuid, text, text, text, uuid) to authenticated;
