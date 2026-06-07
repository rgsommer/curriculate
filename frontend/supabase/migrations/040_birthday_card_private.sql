-- 040_birthday_card_private.sql
-- A birthday card is private to the recipient: each person's wish is seen only by
-- its author and by the birthday person (the surprise recipient) — NOT by the rest
-- of the group, and not even after the reveal. So we can honestly tell signers
-- "no one sees what you write except them."
--
-- The recipient is the excluded surprise user (added to excluded_user_ids when they
-- join, via the apply-excluded-on-join trigger). They see the wishes after reveal.

-- Members: keep normal behaviour for every type EXCEPT birthday. For a birthday,
-- the group does NOT get to see others' wishes — only your own (the user_id clause).
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
        and type <> 'birthday'
    )
  );

-- Guests: same carve-out — a guest who signs a birthday card sees only their own
-- wish (via the user_id clause above), never the others'.
drop policy if exists "Guests can view revealed responses" on public.responses;
create policy "Guests can view revealed responses"
  on public.responses for select
  using (
    engagement_id in (
      select id from public.engagements
      where status = 'revealed'
        and public.is_engagement_guest(id)
        and type <> 'birthday'
    )
  );

-- The birthday person (recipient) sees ALL the wishes once the card opens.
drop policy if exists "Birthday card recipient sees wishes" on public.responses;
create policy "Birthday card recipient sees wishes"
  on public.responses for select
  using (
    engagement_id in (
      select id from public.engagements
      where type = 'birthday'
        and status = 'revealed'
        and auth.uid() = any(coalesce(excluded_user_ids, '{}'))
    )
  );
