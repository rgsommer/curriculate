-- 012_invitation_name.sql
-- Capture the invitee's name (parsed from a pasted "Name <email>" entry) so we
-- can greet them by name in the invite email and show it in the invite list.

alter table public.campfire_invitations
  add column if not exists name text;
