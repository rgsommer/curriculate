-- 070_revealed_at.sql
-- Stamp when an engagement is revealed, so the dashboard "Revealed!" group can also
-- surface anything that unlocked today/yesterday (not just per-person unseen ones).
-- A trigger sets it on the status → 'revealed' transition, so EVERY reveal path
-- (cron, host reveal, raffle draw, pledge settle) is covered with no code changes.
-- Existing revealed rows keep revealed_at = null (treated as "not recent").

alter table public.engagements
  add column if not exists revealed_at timestamptz;

create or replace function public.set_revealed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'revealed' and (old.status is distinct from 'revealed') then
    new.revealed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_revealed_at on public.engagements;
create trigger trg_set_revealed_at
  before update on public.engagements
  for each row
  execute function public.set_revealed_at();
