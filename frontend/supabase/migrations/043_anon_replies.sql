-- 043_anon_replies.sql
-- Let members reply to each other anonymously when an engagement is released
-- (e.g. encouraging notes on a Care Check-in without putting your name to it).
-- allow_anon_replies turns the option on per-engagement; a comment posted with
-- anonymous = true is shown as "Anonymous" (UI-level, same as blind responses).

alter table public.engagements
  add column if not exists allow_anon_replies boolean not null default false;

alter table public.comments
  add column if not exists anonymous boolean not null default false;
