-- 038_edit_response_and_responders.sql
-- (1) Let a person edit their own response while the engagement is still active
--     (before the reveal). (2) Give the host a way to see WHO has responded so far
--     without exposing the sealed content.

-- (1) Edit own response — only while the engagement is active (not yet revealed).
--     Covers both members and engagement guests (the row is keyed to the user).
drop policy if exists "Edit own response while active" on public.responses;
create policy "Edit own response while active"
  on public.responses for update
  using (
    auth.uid() = user_id
    and engagement_id in (select id from public.engagements where status = 'active')
  )
  with check (
    auth.uid() = user_id
    and engagement_id in (select id from public.engagements where status = 'active')
  );

-- (2) Who has responded so far. Returns only user_ids (never the sealed content),
--     and only to people who belong to the group (or the engagement's creator), so
--     the host can see who's in and who to nudge — without spoiling the reveal.
create or replace function public.engagement_responders(_eid uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select r.user_id
  from public.responses r
  join public.engagements e on e.id = r.engagement_id
  where r.engagement_id = _eid
    and (
      e.creator_id = auth.uid()
      or e.group_id in (select group_id from public.group_members where user_id = auth.uid())
    );
$$;
grant execute on function public.engagement_responders(uuid) to authenticated, anon;
