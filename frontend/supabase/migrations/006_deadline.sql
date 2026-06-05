-- 006_deadline.sql
-- Support deadline nudges + auto-reveal. Tracks when we last nudged so the
-- cron doesn't spam the same engagement.
alter table public.engagements
  add column if not exists deadline_nudged_at timestamptz;
