-- 058_referrers.sql
-- Campfire referral partners. A flat list (referrals are only 1 deep — a referrer
-- earns on groups started with THEIR code; those groups' members don't cascade up).
-- Seed rows as you onboard partners; the seasonal promo cron emails them a ready-to-
-- post message containing their referral link.
create table if not exists public.campfire_referrers (
  code                 text primary key,
  email                text not null,
  name                 text,
  user_id              uuid references public.profiles,
  active               boolean not null default true,
  -- Dedupe so each seasonal blast goes out once (e.g. "school-2026", "xmas-2026").
  last_promo_campaign  text,
  created_at           timestamptz not null default now()
);

-- Stamp a group with the referrer whose link started it (for attribution later).
alter table public.groups
  add column if not exists referrer_code text references public.campfire_referrers(code);

alter table public.campfire_referrers enable row level security;
-- Server-only (the cron + admin tooling use the service role); no public policies.
