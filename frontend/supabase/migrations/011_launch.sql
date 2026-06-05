-- 011_launch.sql
-- Draft → Launch: a new engagement starts as a DRAFT (launched_at null), visible
-- only to its creator. Launching sets launched_at and (optionally) emails. This
-- lets a creator prep an engagement and announce it later.

alter table public.engagements
  add column if not exists launched_at timestamptz;

-- Existing engagements are already live — keep them visible.
update public.engagements set launched_at = created_at where launched_at is null;

-- Members see launched engagements in their groups; a creator also sees their drafts.
drop policy if exists "Members can view group engagements" on public.engagements;
create policy "Members can view group engagements"
  on public.engagements for select
  using (
    group_id in (select group_id from public.group_members where user_id = auth.uid())
    and (launched_at is not null or creator_id = auth.uid())
  );
