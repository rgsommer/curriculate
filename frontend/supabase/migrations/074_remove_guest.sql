-- 074_remove_guest.sql
-- Let a host/admin remove (uninvite) an engagement guest — e.g. to clean up test
-- entries or someone added by mistake. Mirrors 037's promote RPC, but deletes the
-- guest instead: removes their response/vote for the card, drops the guest row, and
-- recomputes total_expected (there's no delete-trigger, unlike the join path in 036).
-- Requires 036 + 037.

create or replace function public.remove_engagement_guest(_eid uuid, _uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  gid uuid;
begin
  select group_id into gid from public.engagements where id = _eid;
  if gid is null then
    raise exception 'Engagement not found';
  end if;
  -- Only the host (engagement creator) or a group admin may remove a guest.
  if not public.is_group_admin(gid)
     and not exists (select 1 from public.engagements where id = _eid and creator_id = auth.uid())
  then
    raise exception 'Only an admin or the host can remove a guest';
  end if;

  -- Drop their response/vote on this card (cascades to answers, reactions, etc.),
  -- then the guest record itself.
  delete from public.responses where engagement_id = _eid and user_id = _uid;
  delete from public.engagement_guests where engagement_id = _eid and user_id = _uid;

  -- Recompute "X of Y" (non-excluded members + remaining guests) for this card.
  update public.engagements e
    set total_expected = (
      select count(*) from public.group_members gm
      where gm.group_id = e.group_id
        and not (gm.user_id = any(coalesce(e.excluded_user_ids, '{}')))
    ) + (
      select count(*) from public.engagement_guests eg where eg.engagement_id = e.id
    )
  where e.id = _eid;
end;
$$;
grant execute on function public.remove_engagement_guest(uuid, uuid) to authenticated, anon;
