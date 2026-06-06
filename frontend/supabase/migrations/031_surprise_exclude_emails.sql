-- 031_surprise_exclude_emails.sql
-- Let a surprise exclude people who HAVEN'T joined yet (by email). When such a
-- person later joins, they get added to the engagement's excluded_user_ids, so
-- they stay hidden until the reveal.

alter table public.engagements
  add column if not exists excluded_emails text[] not null default '{}';

-- On join: if the new member's email is on an active engagement's excluded list,
-- add their user id to that engagement's excluded_user_ids. Named to run BEFORE
-- the total_expected bump (alphabetical trigger order) so the recount excludes them.
create or replace function public.apply_excluded_on_join()
returns trigger language plpgsql security definer set search_path = public as $$
declare _email text;
begin
  select email into _email from auth.users where id = new.user_id;
  if _email is null then return new; end if;
  update public.engagements e
    set excluded_user_ids = array_append(e.excluded_user_ids, new.user_id)
    where e.group_id = new.group_id
      and e.status = 'active'
      and not (new.user_id = any(e.excluded_user_ids))
      and lower(_email) in (select lower(x) from unnest(e.excluded_emails) x);
  return new;
end;
$$;

drop trigger if exists aaa_apply_excluded_on_join on public.group_members;
create trigger aaa_apply_excluded_on_join
  after insert on public.group_members
  for each row execute procedure public.apply_excluded_on_join();
