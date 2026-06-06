-- 032_cover_image.sql
-- Optional banner/cover image for an engagement (e.g. a "Happy Birthday"
-- graphic on a surprise card). Just a URL — uploaded to storage or pasted in.

alter table public.engagements
  add column if not exists cover_image_url text;
