-- 044_invite_emailed_at.sql
-- Track when an invitation was last actually emailed (the initial "new engagement"
-- email at launch, the immediate email when added to a live group, or a nudge) so
-- the host can see who's been reached without nudging to find out.
alter table public.campfire_invitations
  add column if not exists last_emailed_at timestamptz;
