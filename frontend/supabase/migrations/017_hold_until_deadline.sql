-- 017_hold_until_deadline.sql
-- A sealed engagement normally reveals the instant every JOINED member responds.
-- When you're still waiting on invitees to join, that can fire too early. This
-- adds an opt-in "hold until the deadline" flag: the reveal waits for the date
-- (the cron reveals it then) even if everyone present has already answered.

alter table public.engagements
  add column if not exists hold_until_deadline boolean not null default false;

-- Don't auto-reveal a held engagement when responses complete — wait for the cron.
create or replace function public.check_all_responded()
returns trigger language plpgsql security definer as $$
declare
  eng record;
  response_count int;
begin
  select * into eng from public.engagements where id = new.engagement_id;
  select count(*) into response_count
    from public.responses where engagement_id = new.engagement_id;

  if response_count >= eng.total_expected
     and eng.total_expected >= 2
     and not coalesce(eng.hold_until_deadline, false) then
    if eng.reveal in ('sealed', 'as_they_come', 'instant', 'first_in') then
      update public.engagements set status = 'revealed' where id = new.engagement_id;
    end if;
  end if;
  return new;
end;
$$;
