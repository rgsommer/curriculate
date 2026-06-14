-- 069_engagement_types.sql
-- The engagements.type column is a Postgres enum (engagement_type). The new prize/
-- fundraiser types added in the app weren't in the enum, so creating one fails with
-- "invalid input value for enum engagement_type". Add them. IF NOT EXISTS makes this
-- safe to re-run and harmless for any value that's already present.
--
-- NOTE: ALTER TYPE ... ADD VALUE works on Postgres 12+ (Supabase is fine). The new
-- values can't be USED in the same transaction they're added in, but these statements
-- only add them, so applying this script as-is is fine.

alter type engagement_type add value if not exists 'tournament';
alter type engagement_type add value if not exists 'pledge_drive';
alter type engagement_type add value if not exists 'raffle_draw';
