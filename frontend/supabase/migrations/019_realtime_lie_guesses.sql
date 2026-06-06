-- 019_realtime_lie_guesses.sql
-- Live-refresh polish for Two Truths & a Lie: broadcast guess inserts so the
-- "X of Y players have guessed" progress (and the auto-reveal) update for
-- everyone without a manual refresh. The reveal flip itself already rides on the
-- engagements UPDATE feed (migration 015). Idempotent.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'campfire_lie_guesses'
  ) then
    alter publication supabase_realtime add table public.campfire_lie_guesses;
  end if;
end $$;
