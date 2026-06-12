-- 059_referral_earnings.sql
-- Referral economics: when a gift happens in a group that was started from a
-- referrer's link, a service fee (2%) is added on top of the gift — half to the
-- referrer, half to the platform. We record the referrer + their cut on each
-- contribution so earnings are a simple sum (paid out manually for now).
-- If an earlier 058 added a FK on groups.referrer_code, drop it — an unknown ?ref
-- must never block group creation.
alter table public.groups drop constraint if exists groups_referrer_code_fkey;

alter table public.campfire_gift_contributions
  add column if not exists referrer_code text,
  add column if not exists referrer_cut_cents int not null default 0;

create index if not exists campfire_gift_contributions_referrer_idx
  on public.campfire_gift_contributions (referrer_code);

-- A referrer's own dashboard: groups they referred, gift volume, and earnings to
-- date. SECURITY DEFINER so it can read across groups, but only for codes the
-- caller owns (campfire_referrers.user_id = auth.uid()).
create or replace function public.my_referral_earnings()
returns table (
  code text,
  groups_referred int,
  gift_volume_cents bigint,
  earned_cents bigint
)
language sql security definer stable set search_path = public as $$
  select
    r.code,
    (select count(*) from public.groups g where g.referrer_code = r.code)::int,
    coalesce(sum(c.amount_cents) filter (where c.status = 'paid'), 0)::bigint,
    coalesce(sum(c.referrer_cut_cents) filter (where c.status = 'paid'), 0)::bigint
  from public.campfire_referrers r
  left join public.campfire_gift_contributions c on c.referrer_code = r.code
  where r.user_id = auth.uid()
  group by r.code;
$$;
grant execute on function public.my_referral_earnings() to authenticated;
