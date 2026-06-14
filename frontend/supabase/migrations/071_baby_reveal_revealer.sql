-- 071_baby_reveal_revealer.sql
-- Baby Reveal: the host can designate WHO reveals (the person having the baby) via
-- engagement.config.babyReveal.revealerUserId. That person needs to set the secret
-- answer (the real name + gender), so widen the write policy on reveal answers to
-- allow the engagement's creator OR the designated revealer.

drop policy if exists "Creator manages reveal answer" on public.campfire_reveal_answers;
create policy "Creator manages reveal answer" on public.campfire_reveal_answers
  for all using (
    exists (
      select 1 from public.engagements e
      where e.id = campfire_reveal_answers.engagement_id
        and (
          e.creator_id = auth.uid()
          or (e.config -> 'babyReveal' ->> 'revealerUserId') = auth.uid()::text
        )
    )
  ) with check (
    exists (
      select 1 from public.engagements e
      where e.id = campfire_reveal_answers.engagement_id
        and (
          e.creator_id = auth.uid()
          or (e.config -> 'babyReveal' ->> 'revealerUserId') = auth.uid()::text
        )
    )
  );
