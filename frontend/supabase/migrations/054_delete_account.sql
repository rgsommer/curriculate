-- 054_delete_account.sql
-- In-app account deletion (Apple requires it for apps with accounts). A signed-in
-- user calls this to erase themselves: the groups they HOST (which cascades those
-- groups' engagements/responses/members), their participation everywhere else, then
-- their profile and auth account. Runs SECURITY DEFINER so it can reach auth.users;
-- it only ever acts on auth.uid(), so a user can delete only themselves.
create or replace function public.campfire_delete_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  -- Content I own — cascades the group's engagements, members, responses, invites.
  delete from public.groups where creator_id = uid;
  -- Engagements I created in groups I don't own.
  delete from public.engagements where creator_id = uid;

  -- My participation across other people's groups.
  delete from public.responses where user_id = uid;
  delete from public.reactions where user_id = uid;
  delete from public.comments where user_id = uid;
  delete from public.nudges where from_user_id = uid or to_user_id = uid;
  delete from public.campfire_ratings where rater_id = uid;
  delete from public.campfire_reports where reporter_id = uid;
  delete from public.campfire_care_answers where user_id = uid;
  delete from public.group_members where user_id = uid;

  -- Nullable references back to me — keep the rows, drop the link.
  update public.engagements set chain_next_creator_id = null where chain_next_creator_id = uid;
  update public.campfire_invitations set invited_by = null where invited_by = uid;
  update public.campfire_lie_guesses set author_guess = null where author_guess = uid;

  -- Finally the profile and the login itself.
  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.campfire_delete_account() to authenticated;
