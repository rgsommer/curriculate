-- 005_reveal_modes.sql
-- Make the non-sealed reveal modes actually behave differently.
--   sealed       → hidden until everyone responds, then auto-reveal (unchanged)
--   all_at_once  → hidden until the creator triggers the reveal (manual)
--   as_they_come → responses visible live as they arrive
--   instant      → responses visible immediately

-- Responses are visible to members when the engagement is revealed OR when its
-- reveal mode is a live one (as_they_come / instant). (You always see your own.)
drop policy if exists "Sealed response visibility" on public.responses;
create policy "Sealed response visibility"
  on public.responses for select
  using (
    user_id = auth.uid()
    or engagement_id in (
      select id from public.engagements
      where group_id in (
              select group_id from public.group_members where user_id = auth.uid()
            )
        and (status = 'revealed' or reveal in ('as_they_come', 'instant'))
    )
  );

-- Auto-reveal when everyone has responded — for every mode EXCEPT all_at_once
-- (which waits for the creator to trigger it).
create or replace function public.check_all_responded()
returns trigger language plpgsql security definer as $$
declare
  eng record;
  response_count int;
begin
  select * into eng from public.engagements where id = new.engagement_id;

  select count(*) into response_count
  from public.responses where engagement_id = new.engagement_id;

  if response_count >= eng.total_expected then
    if eng.reveal in ('sealed', 'as_they_come', 'instant', 'first_in') then
      update public.engagements
      set status = 'revealed'
      where id = new.engagement_id;
    end if;
  end if;

  return new;
end;
$$;
