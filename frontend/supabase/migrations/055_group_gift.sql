-- 055_group_gift.sql
-- "Chip in toward a group gift": the host enables it on a card, participants pay a
-- contribution when they commit (Stripe), and on reveal a gift card for the pooled
-- total is emailed to the recipient (via Tremendous/Tango). Money is collected up
-- front and refunded if the card is canceled before reveal.

-- ── Per-engagement gift config ──
alter table public.engagements
  add column if not exists gift_enabled boolean not null default false,
  -- Where the gift card is emailed on reveal (the recipient).
  add column if not exists gift_recipient_email text,
  add column if not exists gift_recipient_name text,
  -- Suggested chip-in amounts shown to participants (cents).
  add column if not exists gift_suggested_cents int[] not null default '{500,1000,2000}',
  -- Issuance bookkeeping (idempotency: only issue once).
  add column if not exists gift_issued_at timestamptz,
  add column if not exists gift_order_id text;

-- ── Contributions ──
create table if not exists public.campfire_gift_contributions (
  id                    uuid primary key default gen_random_uuid(),
  engagement_id         uuid not null references public.engagements on delete cascade,
  user_id               uuid references public.profiles,     -- null for name-only guests
  contributor_name      text,
  amount_cents          int not null check (amount_cents > 0),
  status                text not null default 'pending',     -- pending | paid | refunded
  stripe_session_id     text,
  stripe_payment_intent text,
  created_at            timestamptz not null default now()
);
create index if not exists campfire_gift_contributions_eng_idx
  on public.campfire_gift_contributions (engagement_id);
alter table public.campfire_gift_contributions enable row level security;

-- Rows are written by the server (checkout route + webhook, service role). Group
-- members may READ them to see the running total — but NOT the recipient, so the
-- surprise (and the amount) stays hidden from them.
drop policy if exists "Members see gift contributions" on public.campfire_gift_contributions;
create policy "Members see gift contributions"
  on public.campfire_gift_contributions for select
  using (
    exists (
      select 1 from public.engagements e
      where e.id = campfire_gift_contributions.engagement_id
        and e.group_id in (
              select group_id from public.group_members where user_id = auth.uid()
            )
        and not (auth.uid() = any (coalesce(e.excluded_user_ids, '{}')))
    )
  );

-- Running total for contributors (paid only), bypassing RLS so a guest who isn't a
-- group member can still see what they're chipping into. Returns amounts only.
create or replace function public.gift_contribution_summary(_eid uuid)
returns table (total_cents int, contributors int)
language sql security definer stable set search_path = public as $$
  select coalesce(sum(amount_cents), 0)::int as total_cents,
         count(*)::int as contributors
  from public.campfire_gift_contributions
  where engagement_id = _eid and status = 'paid';
$$;
grant execute on function public.gift_contribution_summary(uuid) to authenticated, anon;
