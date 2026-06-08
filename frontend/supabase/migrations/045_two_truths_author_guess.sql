-- 045_two_truths_author_guess.sql
-- Persist "who wrote this?" guesses for anonymous Two Truths, so we can crown the
-- "most carefully concealed" player at the reveal. A guesser has one row per
-- response (the existing unique (response_id, guesser_id)); it may hold a lie
-- guess (guess_index), an author guess (author_guess), or both — so make
-- guess_index nullable and add the author column.
alter table public.campfire_lie_guesses
  alter column guess_index drop not null;

alter table public.campfire_lie_guesses
  add column if not exists author_guess uuid references public.profiles(id);

-- The lie-reveal trigger counts guess rows to decide when everyone has guessed.
-- Author-only guesses now create rows with a null guess_index, so they must NOT
-- count toward the lie-guess tally (else lies would reveal early). Recreate the
-- trigger function to count only rows that actually hold a lie guess.
create or replace function public.check_all_guessed()
returns trigger language plpgsql security definer set search_path = public as $$
declare r int; g int; eng record;
begin
  select * into eng from public.engagements where id = new.engagement_id;
  if eng.lies_revealed_at is not null then return new; end if;
  select count(*) into r from public.responses where engagement_id = new.engagement_id;
  select count(*) into g from public.campfire_lie_guesses
    where engagement_id = new.engagement_id and guess_index is not null;
  if r >= 2 and g >= r * (r - 1) then
    update public.engagements set lies_revealed_at = now() where id = new.engagement_id;
  end if;
  return new;
end;
$$;
