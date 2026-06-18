-- 073_hall_of_fame.sql
-- "Hall of Fame" — a superlatives/awards engagement. The host picks a set of awards
-- (Best Dressed, Funniest, …); everyone votes a group-mate for each (sealed until the
-- reveal), then a graph + winner is shown per award. Reuses the existing responses
-- table (votes stored in content.answers as { awardIndex: winnerUserId }) and the
-- group-gift pot, so this only needs the new engagement_type enum value.

alter type engagement_type add value if not exists 'hall_of_fame';
