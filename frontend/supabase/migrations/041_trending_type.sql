-- 041_trending_type.sql
-- The most popular engagement type across ALL users (for a "Trending now" chip on
-- the dashboard). SECURITY DEFINER so it can aggregate past a normal user's RLS —
-- it returns only the winning type + its count, never anyone's content.
-- Prefers the last 30 days ("trending"); falls back to all-time if none recently.
create or replace function public.trending_engagement_type()
returns table(type text, cnt bigint)
language sql stable security definer set search_path = public as $$
  with recent as (
    select e.type::text as t, count(*)::bigint as c
    from public.engagements e
    where e.created_at > now() - interval '30 days'
    group by e.type
    order by c desc
    limit 1
  ),
  alltime as (
    select e.type::text as t, count(*)::bigint as c
    from public.engagements e
    group by e.type
    order by c desc
    limit 1
  )
  select t as type, c as cnt
  from (
    select t, c, 1 as pri from recent
    union all
    select t, c, 2 as pri from alltime
  ) x
  order by pri
  limit 1;
$$;
grant execute on function public.trending_engagement_type() to authenticated, anon;
