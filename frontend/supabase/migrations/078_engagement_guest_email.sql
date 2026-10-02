-- 078_engagement_guest_email.sql
-- Optional result-email for engagement guests. A student who joins a contest via an
-- Edsby link (as an engagement guest, not a group member) can leave an email to get the
-- results when they reveal. Group members already have group_members.notify_email; this
-- is the guest-only equivalent. The join page only offers it for result-returning
-- engagements, so one-way cards never collect it (card = no results, contest = results).

alter table public.engagement_guests
  add column if not exists email text;
