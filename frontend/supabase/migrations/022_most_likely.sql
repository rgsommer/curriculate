-- 022_most_likely.sql
-- "Most Likely To..." (class superlatives): one engagement holds several awards.
-- Each member votes a group-mate for each award; sealed until everyone's in, then
-- the winner of each award is revealed. Votes live in the response content
-- ({ answers: { "0": userId, ... } }) so no new tables are needed.

alter type engagement_type add value if not exists 'most_likely';
