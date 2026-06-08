-- 050_engagement_paused.sql
-- Let a host PAUSE a launched engagement to make changes safely — e.g. add the
-- surprise recipient and mark them "hide from" — without anything going out. While
-- paused, no invite/nudge/launch emails send and the cron skips it (no auto-open,
-- auto-reveal, auto-nudge, or recurrence roll-forward). Un-pausing resumes everything.

alter table public.engagements
  add column if not exists paused boolean not null default false;
