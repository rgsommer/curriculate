-- 009_recount_on_join.sql
-- Keep total_expected in sync as members join: when someone joins a group, bump
-- the expected-responder count on that group's still-active engagements. So an
-- engagement created (or reactivated) while solo still reveals correctly once
-- students join and everyone responds.
create or replace function public.bump_total_expected()
returns trigger language plpgsql security definer as $$
begin
  update public.engagements
    set total_expected = (
      select count(*) from public.group_members where group_id = new.group_id
    )
    where group_id = new.group_id and status = 'active';
  return new;
end;
$$;

drop trigger if exists on_member_join_bump on public.group_members;
create trigger on_member_join_bump
  after insert on public.group_members
  for each row execute procedure public.bump_total_expected();
