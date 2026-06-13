-- 067_pledge_drive.sql
-- Pledge Drive (Read-A-Thon, Bike-A-Thon…). Reuses the embedded gift_* columns for
-- the recipient + Tremendous payout, and campfire_gift_contributions for each
-- sponsor's pledge. These two columns capture the conditional part so the release
-- flow can settle each pledge against the actual result:
--   • pledge_per_unit_cents = the per-unit rate (0 = a flat lump sum)
--   • pledge_max_cents      = the sponsor's cap (also the amount charged upfront)
-- amount_cents holds what's currently collected (the upfront estimate, capped at
-- the max); at release we partial-refund down to min(actual * per_unit, max).
-- Regular chip-ins never set these (the checkout only sends them for a pledge), so
-- existing flows are unaffected until this migration is applied.

alter table public.campfire_gift_contributions
  add column if not exists pledge_per_unit_cents integer not null default 0;
alter table public.campfire_gift_contributions
  add column if not exists pledge_max_cents integer not null default 0;

-- Anonymized pledge leaderboard: amounts (and whether per-unit) for a pledge drive,
-- biggest first. No names — members see the amounts, not who pledged what.
create or replace function public.campfire_pledge_amounts(_eid uuid)
returns table (amount_cents integer, per_unit_cents integer)
language sql
security definer
set search_path = public
as $$
  select amount_cents, pledge_per_unit_cents
  from public.campfire_gift_contributions
  where engagement_id = _eid and status = 'paid'
  order by amount_cents desc
  limit 200;
$$;
grant execute on function public.campfire_pledge_amounts(uuid) to authenticated;
