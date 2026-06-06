-- 033_birthday.sql
-- "Birthday" engagement: a surprise card that auto-runs every year — opens a
-- lead time before the date and reveals ON the date. Optional birth year lets
-- the title auto-compute the age ({age} -> 28th, 29th, …) so it never goes stale.

alter type engagement_type add value if not exists 'birthday';

alter table public.engagements
  add column if not exists scheduled_open_at timestamptz, -- auto-launch a draft at this time
  add column if not exists lead_days int not null default 14, -- open this many days before
  add column if not exists birth_year int; -- for the {age} token in the title
