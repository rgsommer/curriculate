-- 037_promote_guest.sql
-- Let a host/admin turn an engagement guest into a full group member — "let the
-- invited person join the group." Builds on 036 (engagement_guests).
--
-- Requires 036 to have been run first.

-- The host (engagement creator) or a group admin can see the guests on their card,
-- so they can decide who to bring into the group. (036 only let a guest see their
-- own row.)
drop policy if exists "Hosts see their engagement guests" on public.engagement_guests;
create policy "Hosts see their engagement guests"
  on public.engagement_guests for select
  using (
    exists (
      select 1 from public.engagements e
      where e.id = engagement_id
        and (e.creator_id = auth.uid() or public.is_group_admin(e.group_id))
    )
  );

-- Promote a guest to a full group member. Removes their guest row and adds them to
-- group_members — the member-insert trigger recomputes total_expected, and because
-- the guest row is gone first they aren't double-counted. Their existing responses
-- are tied to user_id, so nothing they've already signed is lost.
create or replace function public.promote_guest_to_member(_eid uuid, _uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  gid uuid;
begin
  select group_id into gid from public.engagements where id = _eid;
  if gid is null then
    raise exception 'Engagement not found';
  end if;
  -- Only the host (engagement creator) or a group admin may do this.
  if not public.is_group_admin(gid)
     and not exists (select 1 from public.engagements where id = _eid and creator_id = auth.uid())
  then
    raise exception 'Only an admin or the host can add a guest to the group';
  end if;

  delete from public.engagement_guests where engagement_id = _eid and user_id = _uid;
  insert into public.group_members (group_id, user_id, role)
    values (gid, _uid, 'member')
    on conflict (group_id, user_id) do nothing;
end;
$$;
grant execute on function public.promote_guest_to_member(uuid, uuid) to authenticated, anon;
