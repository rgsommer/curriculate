-- 008_notify_and_solo.sql
-- (1) Don't auto-reveal until at least 2 people are expected — a lone creator
--     answering their own engagement should NOT instantly reveal.
-- (2) Email-notification flags on engagements.

create or replace function public.check_all_responded()
returns trigger language plpgsql security definer as $$
declare
  eng record;
  response_count int;
begin
  select * into eng from public.engagements where id = new.engagement_id;
  select count(*) into response_count
    from public.responses where engagement_id = new.engagement_id;

  if response_count >= eng.total_expected and eng.total_expected >= 2 then
    if eng.reveal in ('sealed', 'as_they_come', 'instant', 'first_in') then
      update public.engagements set status = 'revealed' where id = new.engagement_id;
    end if;
  end if;
  return new;
end;
$$;

alter table public.engagements
  add column if not exists notify boolean not null default false;
alter table public.engagements
  add column if not exists reveal_notified_at timestamptz;
