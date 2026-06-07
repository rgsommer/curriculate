-- 039_engagement_share_code.sql
-- A short, friendly share code per engagement, so a card link can be
-- curriculate.net/c/AB12CD instead of /campfirelive/join/<groupcode>?e=<uuid>.

-- Add the column, backfill existing rows, then enforce uniqueness + a default for
-- new rows. (Backfill before the unique index so each row gets its own code.)
alter table public.engagements
  add column if not exists share_code text;

update public.engagements
  set share_code = public.generate_invite_code(6)
  where share_code is null;

create unique index if not exists idx_engagements_share_code
  on public.engagements(share_code);

alter table public.engagements
  alter column share_code set default public.generate_invite_code(6);
