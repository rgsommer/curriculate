-- 068_contributor_email.sql
-- Store an anonymous (QR /give) contributor's email on their contribution so a raffle
-- winner with no account can still be paid (and named contributors can be entered in
-- the draw). Only written for anonymous contributions — logged-in chip-ins use the
-- member's account email, so ordinary flows are unaffected until this is applied.

alter table public.campfire_gift_contributions
  add column if not exists contributor_email text;
