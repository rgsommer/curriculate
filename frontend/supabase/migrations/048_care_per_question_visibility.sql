-- 048_care_per_question_visibility.sql
-- Move Care Check-in answers out of responses.content and into one row PER QUESTION,
-- so each prompt can have its own visibility (host-only / shared / shared-anonymous).
--
-- Why a child table: RLS is row-level, so a single response row can't keep one answer
-- private while sharing another — the whole row leaks. With one row per answer, the
-- database itself enforces per-prompt privacy.
--
--   share_to_group = true  → the group sees this answer
--   share_to_group = false → only the author + host see it
--   share_to_group = null  → follow the engagement default (private_to_host inverted)
--   anonymous              → UI mask only (group sees the value, not the name; host still sees)
--
-- The umbrella public.responses row still exists per (engagement,user) as the "checked
-- in" marker (seen/reveal/edit), but for Care it carries no answer content.

create table if not exists public.campfire_care_answers (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null references public.engagements on delete cascade,
  response_id    uuid not null references public.responses on delete cascade,
  user_id        uuid not null references public.profiles,
  q_index        int  not null,
  value          text not null,
  share_to_group boolean,
  anonymous      boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (response_id, q_index)
);

create index if not exists campfire_care_answers_eng_idx
  on public.campfire_care_answers (engagement_id);

alter table public.campfire_care_answers enable row level security;

-- Author: full control over their own answers (insert / update / delete / read).
drop policy if exists "Author manages own care answers" on public.campfire_care_answers;
create policy "Author manages own care answers"
  on public.campfire_care_answers for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Group members: see answers shared to the group once the engagement is live/revealed.
drop policy if exists "Members see shared care answers" on public.campfire_care_answers;
create policy "Members see shared care answers"
  on public.campfire_care_answers for select
  using (
    exists (
      select 1 from public.engagements e
      where e.id = campfire_care_answers.engagement_id
        and e.group_id in (
              select group_id from public.group_members where user_id = auth.uid()
            )
        and (e.status = 'revealed' or e.reveal in ('as_they_come', 'instant'))
        and case
              when coalesce(e.private_to_host, false)
                then campfire_care_answers.share_to_group is true
              else campfire_care_answers.share_to_group is not false
            end
    )
  );

-- Host (engagement creator): sees the host-only answers, for pastoral follow-up.
drop policy if exists "Host sees host-only care answers" on public.campfire_care_answers;
create policy "Host sees host-only care answers"
  on public.campfire_care_answers for select
  using (
    exists (
      select 1 from public.engagements e
      where e.id = campfire_care_answers.engagement_id
        and e.creator_id = auth.uid()
        and case
              when coalesce(e.private_to_host, false)
                then campfire_care_answers.share_to_group is not true
              else campfire_care_answers.share_to_group is false
            end
    )
  );
