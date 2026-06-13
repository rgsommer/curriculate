-- 064_group_school.sql
-- Optionally record the school/organization a group is for. Used to waive the
-- referral program inside the operator's own school community (no fee, no cut) so
-- there's no conflict of interest — see isHouseSchool() in lib/campfire/types.ts.
-- When a group is for a "house" school, the client simply doesn't stamp a
-- referrer_code, so chip-ins add no service fee and record no referrer cut.
alter table public.groups
  add column if not exists school text;
