-- 014_invite_privacy_and_reconcile.sql
-- Two fixes prompted by: a regular member could see the invitation list (every
-- invitee's email) plus nudge/revoke controls; and an invitee who had already
-- joined still showed as "pending".

-- A) Privacy: the invitation list is a host tool. Restrict reads to admins —
--    previously ANY group member could read every invited email address.
drop policy if exists "Members view group invitations" on public.campfire_invitations;
drop policy if exists "Admins view group invitations" on public.campfire_invitations;
create policy "Admins view group invitations"
  on public.campfire_invitations for select
  using ( public.is_group_admin(group_id) );

-- B) Keep status in sync the OTHER direction. The existing trigger flips invites
--    to 'joined' when a member is ADDED. This one flips a freshly inserted/updated
--    invite to 'joined' if that email already belongs to a member of the group
--    (covers an invite created/re-added after the person had already joined).
create or replace function public.mark_invite_joined_if_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'joined' and exists (
    select 1
    from public.group_members gm
    join auth.users u on u.id = gm.user_id
    where gm.group_id = new.group_id
      and lower(u.email) = lower(new.email)
  ) then
    new.status := 'joined';
    new.joined_at := coalesce(new.joined_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invite_joined_if_member on public.campfire_invitations;
create trigger trg_invite_joined_if_member
  before insert or update on public.campfire_invitations
  for each row execute procedure public.mark_invite_joined_if_member();

-- C) One-time backfill: flip every existing pending invite whose email already
--    belongs to a member of that group (fixes the stuck "pending" rows now).
update public.campfire_invitations i
  set status = 'joined', joined_at = coalesce(i.joined_at, now())
  from public.group_members gm
  join auth.users u on u.id = gm.user_id
  where gm.group_id = i.group_id
    and lower(u.email) = lower(i.email)
    and i.status <> 'joined';
