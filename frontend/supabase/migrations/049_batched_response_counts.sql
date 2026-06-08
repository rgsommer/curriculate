-- 049_batched_response_counts.sql
-- The group page was calling engagement_response_count(_eid) once PER engagement
-- (an N+1: a group with 12 engagements = 12 round-trips just for the progress bars).
-- This batched SECURITY DEFINER variant returns the true count for many engagements
-- in a single call, so the page makes one request instead of N.
--
-- Same secrecy guarantee as the single-id version (016): it returns only counts, no
-- response contents, so the "sealed" RLS policy isn't bypassed for any actual data.

create or replace function public.engagement_response_counts(_eids uuid[])
returns table (engagement_id uuid, n int)
language sql security definer stable set search_path = public as $$
  select r.engagement_id, count(*)::int as n
  from public.responses r
  where r.engagement_id = any(_eids)
  group by r.engagement_id;
$$;

grant execute on function public.engagement_response_counts(uuid[]) to authenticated, anon;
