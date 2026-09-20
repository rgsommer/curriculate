-- 077_late_responses_after_reveal.sql
-- Allow LATE responses after a sealed reveal. Someone who opens the reveal days or weeks
-- later should still be able to add their answer, and later viewers see it. Until now the
-- response INSERT policies required status = 'active', so any post-reveal submit hit
-- "new row violates row-level security policy for table responses" (a raw, scary error).
--
-- This mirrors the app's own `lateResponseAllowed` rule: late responses are fine for
-- cards, care check-ins, shares, open-ended polls, etc. — but NOT for guessing games or
-- tally polls, where seeing the revealed answers first would be unfair. We block the four
-- always-unfair types at the DB level; the app additionally hides the form for closed
-- tally (non-open) polls. Membership and auth.uid() = user_id are still required, and
-- editing an existing response after reveal stays blocked (unchanged UPDATE policy).

-- Members: submit while active, OR after reveal for non-guessing types.
drop policy if exists "Members can submit responses" on public.responses;
create policy "Members can submit responses"
  on public.responses for insert
  with check (
    auth.uid() = user_id
    and engagement_id in (
      select e.id
      from public.engagements e
      join public.group_members gm on gm.group_id = e.group_id
      where gm.user_id = auth.uid()
        and gm.role != 'spectator'
        and (
          e.status = 'active'
          or (
            e.status = 'revealed'
            and e.type::text not in
              ('two_truths', 'most_likely', 'hall_of_fame', 'baby_reveal')
          )
        )
    )
  );

-- Guests (engagement-scoped): same allowance.
drop policy if exists "Guests can submit responses" on public.responses;
create policy "Guests can submit responses"
  on public.responses for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.engagements e
      where e.id = engagement_id
        and public.is_engagement_guest(e.id)
        and (
          e.status = 'active'
          or (
            e.status = 'revealed'
            and e.type::text not in
              ('two_truths', 'most_likely', 'hall_of_fame', 'baby_reveal')
          )
        )
    )
  );
