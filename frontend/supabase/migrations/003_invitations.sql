-- 003_invitations.sql
-- Persistent email invitations so creators can track who was invited, add more,
-- revoke, and nudge people who haven't joined.

create table if not exists public.campfire_invitations (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid references public.groups on delete cascade not null,
  email         text not null,
  invited_by    uuid references public.profiles,
  status        text not null default 'pending' check (status in ('pending','joined','revoked')),
  created_at    timestamptz not null default now(),
  joined_at     timestamptz,
  last_nudged_at timestamptz,
  nudge_count   int not null default 0,
  unique (group_id, email)
);

alter table public.campfire_invitations enable row level security;

-- Any group member can see the group's invitation list.
create policy "Members view group invitations"
  on public.campfire_invitations for select
  using ( public.is_group_member(group_id) );
-- (All writes go through service-role API routes, which bypass RLS.)

create index if not exists idx_campfire_invitations_group
  on public.campfire_invitations (group_id);

-- When an invited email actually joins the group, flip their invite to 'joined'.
create or replace function public.mark_invitation_joined()
returns trigger language plpgsql security definer set search_path = public as $$
declare _email text;
begin
  select email into _email from auth.users where id = new.user_id;
  if _email is not null then
    update public.campfire_invitations
      set status = 'joined', joined_at = now()
      where group_id = new.group_id
        and lower(email) = lower(_email)
        and status <> 'joined';
  end if;
  return new;
end;
$$;

drop trigger if exists on_member_added_mark_invite on public.group_members;
create trigger on_member_added_mark_invite
  after insert on public.group_members
  for each row execute procedure public.mark_invitation_joined();
