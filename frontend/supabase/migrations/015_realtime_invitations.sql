-- 015_realtime_invitations.sql
-- The group page subscribes to realtime changes so joins / invitation updates
-- appear without a manual refresh. Realtime only broadcasts for tables that are
-- in the `supabase_realtime` publication — make sure the ones we subscribe to
-- are all present. Idempotent: only adds a table if it isn't already published.

do $$
declare t text;
begin
  foreach t in array array[
    'group_members', 'engagements', 'responses', 'campfire_invitations'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
