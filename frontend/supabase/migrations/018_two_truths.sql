-- 018_two_truths.sql
-- "Two Truths & a Lie" activity: each player submits 3 statements and privately
-- marks the lie. Statements reveal once everyone has answered (sealed). Then a
-- guessing phase: each player guesses the lie on everyone else's entry. The lies
-- (and scores) reveal only once everyone has guessed everyone.

-- New activity type. (Adding an enum value doesn't use it here, so it's safe to
-- run alongside the rest. If your Postgres complains, run THIS line alone first.)
alter type engagement_type add value if not exists 'two_truths';

-- Phase-2 marker: when the lies + scores are revealed.
alter table public.engagements
  add column if not exists lies_revealed_at timestamptz;

-- The hidden answer (which statement, 0-2, is the lie). Stored OUT of the
-- response content so it can't be read until the lies are revealed.
create table if not exists public.campfire_lie_answers (
  engagement_id uuid not null references public.engagements on delete cascade,
  response_id   uuid primary key references public.responses on delete cascade,
  lie_index     int  not null check (lie_index between 0 and 2),
  created_at    timestamptz not null default now()
);
alter table public.campfire_lie_answers enable row level security;

create policy "Author writes own lie answer" on public.campfire_lie_answers
  for insert with check (
    exists (select 1 from public.responses r
            where r.id = campfire_lie_answers.response_id and r.user_id = auth.uid())
  );
create policy "Lie answer visibility" on public.campfire_lie_answers
  for select using (
    exists (select 1 from public.responses r
            where r.id = campfire_lie_answers.response_id and r.user_id = auth.uid())
    or campfire_lie_answers.engagement_id in (
      select id from public.engagements
      where lies_revealed_at is not null
        and group_id in (select group_id from public.group_members where user_id = auth.uid())
    )
  );

-- Guesses: which statement each player thinks is the lie, per response.
create table if not exists public.campfire_lie_guesses (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements on delete cascade,
  response_id   uuid not null references public.responses on delete cascade,
  guesser_id    uuid not null references public.profiles on delete cascade,
  guess_index   int  not null check (guess_index between 0 and 2),
  created_at    timestamptz not null default now(),
  unique (response_id, guesser_id)
);
alter table public.campfire_lie_guesses enable row level security;

-- You may guess if you're a member who has responded, and not on your own entry.
create policy "Members guess" on public.campfire_lie_guesses
  for insert with check (
    guesser_id = auth.uid()
    and exists (select 1 from public.responses r
                where r.engagement_id = campfire_lie_guesses.engagement_id
                  and r.user_id = auth.uid())
    and not exists (select 1 from public.responses r
                    where r.id = campfire_lie_guesses.response_id
                      and r.user_id = auth.uid())
  );
create policy "Members view guesses" on public.campfire_lie_guesses
  for select using (
    campfire_lie_guesses.engagement_id in (
      select e.id from public.engagements e
      where e.group_id in (select group_id from public.group_members where user_id = auth.uid())
    )
  );

create index if not exists idx_lie_guesses_eng on public.campfire_lie_guesses(engagement_id);
create index if not exists idx_lie_answers_eng on public.campfire_lie_answers(engagement_id);

-- When every responder has guessed every OTHER responder, reveal the lies.
create or replace function public.check_all_guessed()
returns trigger language plpgsql security definer set search_path = public as $$
declare r int; g int; eng record;
begin
  select * into eng from public.engagements where id = new.engagement_id;
  if eng.lies_revealed_at is not null then return new; end if;
  select count(*) into r from public.responses where engagement_id = new.engagement_id;
  select count(*) into g from public.campfire_lie_guesses where engagement_id = new.engagement_id;
  if r >= 2 and g >= r * (r - 1) then
    update public.engagements set lies_revealed_at = now() where id = new.engagement_id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_lie_guess_check on public.campfire_lie_guesses;
create trigger on_lie_guess_check
  after insert on public.campfire_lie_guesses
  for each row execute procedure public.check_all_guessed();
