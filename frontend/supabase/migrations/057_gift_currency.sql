-- 057_gift_currency.sql
-- The group-gift pool (contributions + the issued gift card) is a single currency,
-- set per engagement so it matches the group's region instead of always USD.
alter table public.engagements
  add column if not exists gift_currency text not null default 'usd';
