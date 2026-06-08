-- 042_care_checkin.sql
-- (1) A "Care Check-in" engagement: one form with several optional sections; each
--     person fills in any or all (how they're doing, prayer requests, praise, etc.).
-- (2) A per-engagement "keep responses private to the host" flag — when on, each
--     person's response is seen ONLY by its author and the host (creator), never the
--     rest of the group, even after the reveal. Great for sensitive pastoral sharing.

alter type engagement_type add value if not exists 'care';

alter table public.engagements
  add column if not exists private_to_host boolean not null default false;

-- ── RLS: a private engagement's responses bypass the normal group visibility ──

-- Members: keep normal behaviour, but a private engagement's answers are NOT shown
-- to the group (only your own — via the user_id clause — and the host, below).
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
        and not coalesce(private_to_host, false)
    )
  );

-- Guests: same private carve-out.
drop policy if exists "Guests can view revealed responses" on public.responses;
create policy "Guests can view revealed responses"
  on public.responses for select
  using (
    engagement_id in (
      select id from public.engagements
      where status = 'revealed'
        and public.is_engagement_guest(id)
        and type <> 'birthday'
        and not coalesce(private_to_host, false)
    )
  );

-- The host (engagement creator) sees every response to a private engagement,
-- anytime — so they can follow up pastorally.
drop policy if exists "Host sees private responses" on public.responses;
create policy "Host sees private responses"
  on public.responses for select
  using (
    engagement_id in (
      select id from public.engagements
      where coalesce(private_to_host, false) and creator_id = auth.uid()
    )
  );
