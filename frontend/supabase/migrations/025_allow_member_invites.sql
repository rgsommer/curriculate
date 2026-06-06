-- 025_allow_member_invites.sql
-- Per-group toggle: by default only the host invites, but the host can let any
-- member invite others too. (Nudging/revoking the invite list stays host-only.)

alter table public.groups
  add column if not exists allow_member_invites boolean not null default false;
