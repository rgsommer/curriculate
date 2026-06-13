-- 065_member_notify_email.sql
-- People invited by email who then join via the LINK as a guest get a brand-new
-- anonymous account (no email), so the email invite stays "pending" and the reveal
-- can't reach them. The host can link the two: this column stores a notify-email on
-- the membership (separate from their login) so all Campfire emails reach them.
alter table public.group_members
  add column if not exists notify_email text;
