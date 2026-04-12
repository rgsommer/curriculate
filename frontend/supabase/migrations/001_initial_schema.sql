-- ============================================================
-- Campfire Live — Initial Database Schema
-- Supabase (PostgreSQL) with Row Level Security
-- ============================================================

-- Helper: short random invite codes
create or replace function public.generate_invite_code(len int default 8)
returns text language sql as $$
  select upper(substr(replace(replace(
    encode(gen_random_bytes(6), 'base64'), '+', ''), '/', ''), 1, len));
$$;

-- ────────────────────────────────────────────────────────────
-- PROFILES (extends auth.users)
-- ────────────────────────────────────────────────────────────
create table public.profiles (
  id            uuid references auth.users on delete cascade primary key,
  display_name  text not null,
  avatar_url    text,
  trial_ends_at timestamptz not null default (now() + interval '3 months'),
  is_premium    boolean not null default false,
  stripe_customer_id text,
  allow_random_guest boolean not null default false,
  adult_content  boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view any profile"
  on public.profiles for select using (true);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ────────────────────────────────────────────────────────────
-- GROUPS
-- ────────────────────────────────────────────────────────────
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  invite_code text unique not null default public.generate_invite_code(),
  creator_id  uuid references public.profiles not null,
  avatar_emoji text not null default '🔥',
  created_at  timestamptz not null default now()
);

alter table public.groups enable row level security;

-- Only group members can see the group
create policy "Members can view their groups"
  on public.groups for select
  using (
    id in (select group_id from public.group_members where user_id = auth.uid())
    or creator_id = auth.uid()
  );

create policy "Authenticated users can create groups"
  on public.groups for insert
  with check (auth.uid() = creator_id);

create policy "Group creator can update group"
  on public.groups for update
  using (auth.uid() = creator_id);

-- ────────────────────────────────────────────────────────────
-- GROUP MEMBERS
-- ────────────────────────────────────────────────────────────
create table public.group_members (
  group_id  uuid references public.groups on delete cascade,
  user_id   uuid references public.profiles on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'member', 'spectator')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.group_members enable row level security;

create policy "Members can see fellow members"
  on public.group_members for select
  using (
    group_id in (select group_id from public.group_members gm where gm.user_id = auth.uid())
  );

create policy "Users can join groups"
  on public.group_members for insert
  with check (auth.uid() = user_id);

create policy "Admins can remove members"
  on public.group_members for delete
  using (
    group_id in (
      select group_id from public.group_members
      where user_id = auth.uid() and role = 'admin'
    )
    or auth.uid() = user_id  -- users can leave
  );

-- ────────────────────────────────────────────────────────────
-- ENGAGEMENTS
-- ────────────────────────────────────────────────────────────
create type engagement_type as enum (
  'poll', 'challenge', 'truth_or_dare', 'photo_pose', 'share',
  'accountability', 'game', 'instant', 'anonymous_judge',
  'guess', 'surprise', 'advice', 'voice_response'
);

create type engagement_status as enum (
  'active', 'sealed', 'revealed', 'expired'
);

create type reveal_mode as enum (
  'sealed', 'all_at_once', 'first_in', 'as_they_come', 'instant'
);

create table public.engagements (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid references public.groups on delete cascade not null,
  creator_id      uuid references public.profiles not null,
  type            engagement_type not null,
  title           text not null,
  description     text,
  config          jsonb not null default '{}',
  -- config examples:
  --   poll:      { options: ["A","B","C"], allow_multiple: false }
  --   challenge: { media_type: "photo"|"video", max_duration: 30 }
  --   truth_or_dare: { stakes: null | { amount: 5, currency: "USD" } }
  deadline        timestamptz,
  reveal          reveal_mode not null default 'sealed',
  is_blind        boolean not null default false,
  status          engagement_status not null default 'active',
  total_expected  integer not null default 0,
  -- recurring
  recurrence_rule text, -- cron expression, null = one-off
  parent_id       uuid references public.engagements, -- template source
  -- chain
  chain_next_creator_id uuid references public.profiles,
  created_at      timestamptz not null default now()
);

alter table public.engagements enable row level security;

create policy "Members can view group engagements"
  on public.engagements for select
  using (
    group_id in (select group_id from public.group_members where user_id = auth.uid())
  );

create policy "Members can create engagements"
  on public.engagements for insert
  with check (
    auth.uid() = creator_id
    and group_id in (select group_id from public.group_members where user_id = auth.uid())
  );

create policy "Creator can update engagement"
  on public.engagements for update
  using (auth.uid() = creator_id);

-- Auto-set total_expected from group member count
create or replace function public.set_engagement_total()
returns trigger language plpgsql as $$
begin
  if new.total_expected = 0 then
    new.total_expected := (
      select count(*) from public.group_members
      where group_id = new.group_id and role != 'spectator'
    );
  end if;
  return new;
end;
$$;

create trigger set_total_before_insert
  before insert on public.engagements
  for each row execute procedure public.set_engagement_total();

-- ────────────────────────────────────────────────────────────
-- RESPONSES
-- ────────────────────────────────────────────────────────────
create table public.responses (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid references public.engagements on delete cascade not null,
  user_id        uuid references public.profiles not null,
  content        jsonb not null,
  -- content examples:
  --   poll:      { option: "A" } or { options: ["A","C"] }
  --   challenge: { media_url: "...", caption: "..." }
  --   voice:     { voice_url: "...", duration: 12 }
  --   text:      { text: "..." }
  rating         numeric(3,1), -- post-reveal rating from group
  created_at     timestamptz not null default now(),
  unique (engagement_id, user_id)
);

alter table public.responses enable row level security;

-- SEALED MECHANIC: responses visible only when engagement is revealed
-- OR to the user who submitted them (they can see their own)
create policy "Sealed response visibility"
  on public.responses for select
  using (
    user_id = auth.uid()  -- always see your own
    or (
      engagement_id in (
        select id from public.engagements
        where status = 'revealed'
          and group_id in (select group_id from public.group_members where user_id = auth.uid())
      )
    )
  );

create policy "Members can submit responses"
  on public.responses for insert
  with check (
    auth.uid() = user_id
    and engagement_id in (
      select e.id from public.engagements e
      join public.group_members gm on gm.group_id = e.group_id
      where gm.user_id = auth.uid() and gm.role != 'spectator'
      and e.status = 'active'
    )
  );

-- Auto-check if all responses are in → seal → reveal
create or replace function public.check_all_responded()
returns trigger language plpgsql security definer as $$
declare
  eng record;
  response_count int;
begin
  select * into eng from public.engagements where id = new.engagement_id;

  select count(*) into response_count
  from public.responses where engagement_id = new.engagement_id;

  -- If all expected responses are in
  if response_count >= eng.total_expected then
    -- For sealed reveal mode, auto-reveal
    if eng.reveal = 'sealed' then
      update public.engagements
      set status = 'revealed'
      where id = new.engagement_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger check_responses_after_insert
  after insert on public.responses
  for each row execute procedure public.check_all_responded();

-- ────────────────────────────────────────────────────────────
-- REACTIONS (post-reveal)
-- ────────────────────────────────────────────────────────────
create table public.reactions (
  id          uuid primary key default gen_random_uuid(),
  response_id uuid references public.responses on delete cascade not null,
  user_id     uuid references public.profiles not null,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  unique (response_id, user_id, emoji)
);

alter table public.reactions enable row level security;

create policy "Members can view reactions"
  on public.reactions for select
  using (
    response_id in (
      select r.id from public.responses r
      join public.engagements e on e.id = r.engagement_id
      where e.status = 'revealed'
        and e.group_id in (select group_id from public.group_members where user_id = auth.uid())
    )
  );

create policy "Members can add reactions"
  on public.reactions for insert
  with check (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- COMMENTS (post-reveal)
-- ────────────────────────────────────────────────────────────
create table public.comments (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid references public.engagements on delete cascade not null,
  response_id   uuid references public.responses on delete cascade,
  user_id       uuid references public.profiles not null,
  content       text not null,
  created_at    timestamptz not null default now()
);

alter table public.comments enable row level security;

create policy "Members can view comments"
  on public.comments for select
  using (
    engagement_id in (
      select id from public.engagements
      where status = 'revealed'
        and group_id in (select group_id from public.group_members where user_id = auth.uid())
    )
  );

create policy "Members can add comments"
  on public.comments for insert
  with check (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- NUDGES
-- ────────────────────────────────────────────────────────────
create table public.nudges (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid references public.engagements on delete cascade not null,
  from_user_id  uuid references public.profiles not null,
  to_user_id    uuid references public.profiles not null,
  created_at    timestamptz not null default now()
);

alter table public.nudges enable row level security;

create policy "Nudge participants can view"
  on public.nudges for select
  using (from_user_id = auth.uid() or to_user_id = auth.uid());

create policy "Members can send nudges"
  on public.nudges for insert
  with check (auth.uid() = from_user_id);

-- ────────────────────────────────────────────────────────────
-- STREAKS
-- ────────────────────────────────────────────────────────────
create table public.streaks (
  user_id            uuid references public.profiles on delete cascade,
  group_id           uuid references public.groups on delete cascade,
  current_streak     integer not null default 0,
  longest_streak     integer not null default 0,
  last_participated  timestamptz,
  primary key (user_id, group_id)
);

alter table public.streaks enable row level security;

create policy "Members can view streaks"
  on public.streaks for select
  using (
    group_id in (select group_id from public.group_members where user_id = auth.uid())
  );

-- Update streak when a response is submitted
create or replace function public.update_streak()
returns trigger language plpgsql security definer as $$
declare
  eng record;
  streak record;
begin
  select * into eng from public.engagements where id = new.engagement_id;

  select * into streak from public.streaks
  where user_id = new.user_id and group_id = eng.group_id;

  if streak is null then
    insert into public.streaks (user_id, group_id, current_streak, longest_streak, last_participated)
    values (new.user_id, eng.group_id, 1, 1, now());
  else
    -- If last participation was within 48 hours, increment streak
    if streak.last_participated > now() - interval '48 hours' then
      update public.streaks
      set current_streak = current_streak + 1,
          longest_streak = greatest(longest_streak, current_streak + 1),
          last_participated = now()
      where user_id = new.user_id and group_id = eng.group_id;
    else
      -- Streak broken, restart
      update public.streaks
      set current_streak = 1,
          last_participated = now()
      where user_id = new.user_id and group_id = eng.group_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger update_streak_on_response
  after insert on public.responses
  for each row execute procedure public.update_streak();

-- ────────────────────────────────────────────────────────────
-- MILESTONES
-- ────────────────────────────────────────────────────────────
create table public.milestones (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid references public.groups on delete cascade not null,
  type      text not null, -- 'engagement_count', 'streak', 'member_count'
  value     integer not null,
  reached_at timestamptz not null default now()
);

alter table public.milestones enable row level security;

create policy "Members can view milestones"
  on public.milestones for select
  using (
    group_id in (select group_id from public.group_members where user_id = auth.uid())
  );

-- ────────────────────────────────────────────────────────────
-- FAVOURITES
-- ────────────────────────────────────────────────────────────
create table public.favourites (
  user_id       uuid references public.profiles on delete cascade,
  engagement_id uuid references public.engagements on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, engagement_id)
);

alter table public.favourites enable row level security;

create policy "Users can view own favourites"
  on public.favourites for select using (user_id = auth.uid());

create policy "Users can add favourites"
  on public.favourites for insert with check (auth.uid() = user_id);

create policy "Users can remove favourites"
  on public.favourites for delete using (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- INDEXES for performance
-- ────────────────────────────────────────────────────────────
create index idx_group_members_user on public.group_members(user_id);
create index idx_engagements_group on public.engagements(group_id, created_at desc);
create index idx_engagements_status on public.engagements(status);
create index idx_responses_engagement on public.responses(engagement_id);
create index idx_reactions_response on public.reactions(response_id);
create index idx_comments_engagement on public.comments(engagement_id);
create index idx_nudges_engagement on public.nudges(engagement_id);
create index idx_groups_invite on public.groups(invite_code);

-- ────────────────────────────────────────────────────────────
-- REALTIME: Enable for key tables
-- ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.responses;
alter publication supabase_realtime add table public.engagements;
alter publication supabase_realtime add table public.reactions;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.nudges;
alter publication supabase_realtime add table public.group_members;

-- ────────────────────────────────────────────────────────────
-- STORAGE: Buckets for media
-- ────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('campfire-media', 'campfire-media', true);

create policy "Authenticated users can upload media"
  on storage.objects for insert
  with check (bucket_id = 'campfire-media' and auth.role() = 'authenticated');

create policy "Anyone can view media"
  on storage.objects for select
  using (bucket_id = 'campfire-media');
