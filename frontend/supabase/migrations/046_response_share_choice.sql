-- 046_response_share_choice.sql
-- Let each PERSON choose their own visibility on a response, overriding the
-- host's default either way:
--   • Host set "private to host" → a responder can still opt to SHARE with the group.
--   • Host left it group-visible  → a responder can opt to keep it host-only.
--
-- New per-response column `share_to_group`:
--   true  → the group sees this response (at the reveal), regardless of the host default
--   false → only the author + host see it, regardless of the host default
--   null  → follow the engagement default (private_to_host inverted)
--
-- The Care Check-in form writes an explicit boolean; other engagement types leave
-- it null, so their visibility is unchanged.

alter table public.responses
  add column if not exists share_to_group boolean;

-- Effective visibility (per response):
--   group-visible  ⇔  CASE private_to_host
--                       WHEN true  THEN share_to_group IS TRUE      -- must opt IN
--                       ELSE             share_to_group IS NOT FALSE -- default in, can opt OUT
--   host-only      ⇔  the complement (what the host, and only the host, still sees)

-- Members: see your own always; otherwise see a response only if it's group-visible.
drop policy if exists "Sealed response visibility" on public.responses;
create policy "Sealed response visibility"
  on public.responses for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.engagements e
      where e.id = responses.engagement_id
        and e.group_id in (
              select group_id from public.group_members where user_id = auth.uid()
            )
        and (e.status = 'revealed' or e.reveal in ('as_they_come', 'instant'))
        and e.type <> 'birthday'
        and case
              when coalesce(e.private_to_host, false)
                then responses.share_to_group is true
              else responses.share_to_group is not false
            end
    )
  );

-- Guests: same group-visibility rule.
drop policy if exists "Guests can view revealed responses" on public.responses;
create policy "Guests can view revealed responses"
  on public.responses for select
  using (
    exists (
      select 1 from public.engagements e
      where e.id = responses.engagement_id
        and e.status = 'revealed'
        and public.is_engagement_guest(e.id)
        and e.type <> 'birthday'
        and case
              when coalesce(e.private_to_host, false)
                then responses.share_to_group is true
              else responses.share_to_group is not false
            end
    )
  );

-- The host (engagement creator) always sees responses that are host-only — whether
-- because the engagement is private, or because this responder opted out of sharing.
drop policy if exists "Host sees private responses" on public.responses;
create policy "Host sees private responses"
  on public.responses for select
  using (
    exists (
      select 1 from public.engagements e
      where e.id = responses.engagement_id
        and e.creator_id = auth.uid()
        and case
              when coalesce(e.private_to_host, false)
                then responses.share_to_group is not true
              else responses.share_to_group is false
            end
    )
  );
