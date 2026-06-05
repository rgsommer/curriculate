-- 010_cancel_engagement.sql
-- Let a creator cancel (delete) their own engagement. Responses/reactions/
-- comments/ratings cascade away with it.
create policy "Creator can delete engagement"
  on public.engagements for delete
  using ( auth.uid() = creator_id );
