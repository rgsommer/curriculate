-- 026_engagement_member_invites.sql
-- Move "can members invite others" from the group to each engagement: a per-
-- engagement flag the creator/host sets. Whole-group invites stay host-only.

alter table public.engagements
  add column if not exists allow_member_invites boolean not null default false;
