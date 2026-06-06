-- 024_scavenger_hunt.sql
-- "Scavenger Hunt": the host lists items (e.g. 15 prompts); each player answers
-- each with a PHOTO or a TEXT answer, in any order. Sealed until the host reveals
-- (end of class). Answers live in the response content
-- ({ answers: { "0": {text?, photo?}, ... } }), so no new tables.

alter type engagement_type add value if not exists 'scavenger_hunt';
