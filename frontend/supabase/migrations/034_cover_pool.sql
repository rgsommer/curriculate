-- 034_cover_pool.sql
-- A pool of cover images — the creator uploads as many as they like and Campfire
-- shows a random one (a fresh pick each year for a recurring birthday).
-- cover_image_url stays the currently-shown one; cover_image_urls is the pool.

alter table public.engagements
  add column if not exists cover_image_urls text[] not null default '{}';
