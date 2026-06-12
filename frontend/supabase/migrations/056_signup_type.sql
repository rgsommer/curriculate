-- 056_signup_type.sql
-- A "Sign-up" engagement: the host lists slots (Drinks, Cupcakes ×2, Music…) and
-- each person claims one or more. Live by nature — everyone sees what's taken. Great
-- for class parties, potlucks, field trips, volunteer/ministry sign-ups.
--
-- Slots live in config.slots = [{ label, capacity }]; a response holds the indices
-- the person claimed: content.claims = [0, 2]. (Run this statement on its own — a new
-- enum value can't be used in the same transaction it's added in.)
alter type engagement_type add value if not exists 'signup';
