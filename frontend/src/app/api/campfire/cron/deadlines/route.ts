import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { issueGiftCard, giftProviderConfigured } from "@/lib/campfire/gifts";
import {
  getNonResponderEmails,
  getGroupMemberEmails,
  getCardRecipients,
  reminderEmail,
  revealEmail,
  cardRevealEmail,
  newEngagementEmail,
  cardLiveEmail,
  buildJoinUrl,
  inviteEmail,
  mailDefaults,
  campfireFrom,
  campfireSiteUrl,
  getPendingInviteeEmails,
  escapeHtml,
} from "@/lib/campfire/serverInvites";
import { ENGAGEMENT_TYPES, resolveTitle, engagementIcon, nthWeekdayOfMonth, nextMonthlyNthWeekday, raffleOf, tournamentOf, selectPoolQuestions, type NthWeekday, type QuestionCategory } from "@/lib/campfire/types";
import { runRaffleDraw } from "@/lib/campfire/raffleDraw";
import { awardHallOfFameGift } from "@/lib/campfire/hallOfFame";

const resend = new Resend(process.env.RESEND_API_KEY);

const GRACE_MS = 24 * 60 * 60 * 1000; // reveal this long past the deadline if not done
const NUDGE_LEAD_MS = 2 * 24 * 60 * 60 * 1000; // start nudging ~2 days before the deadline
const NUDGE_THROTTLE_MS = 20 * 60 * 60 * 1000; // at most ~once a day per engagement

// Vercel strips inbound x-vercel-* headers from external callers, so its
// presence proves a genuine cron invocation. A CRON_SECRET bearer also works.
function authorized(req: Request) {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  const admin = createClient(url, serviceKey);
  const base = campfireSiteUrl();
  const from = campfireFrom();
  const now = Date.now();

  const { data: engs } = await admin
    .from("engagements")
    .select("id, group_id, title, total_expected, deadline, reveal, type, deadline_nudged_at, hold_until_deadline, birth_year, config")
    .eq("status", "active")
    .eq("paused", false) // paused → no auto-reveal / auto-nudge
    .not("deadline", "is", null);

  let revealed = 0;
  let nudged = 0;

  for (const e of engs ?? []) {
    const dl = new Date(e.deadline as string).getTime();

    // A Sign-up is a live list with no reveal phase — the deadline just marks the
    // party date. Never auto-reveal it (nudges below still apply).
    const isSignupEng = e.type === "signup";

    // Raffle Challenge: reveal (→ open voting) when the participation gate is met,
    // or at the deadline as a hard backstop. On reveal, stamp when voting closes.
    const raffle = raffleOf(e.config as Record<string, unknown> | null);
    if (!isSignupEng && raffle) {
      const gate = raffle.participationGate ?? 0;
      let gateMet = false;
      if (gate > 0) {
        const { count: entries } = await admin
          .from("responses")
          .select("*", { count: "exact", head: true })
          .eq("engagement_id", e.id);
        const expected = (e.total_expected as number) || 0;
        gateMet =
          expected > 0 && (entries ?? 0) >= Math.ceil((expected * gate) / 100);
      }
      if (gateMet || now >= dl) {
        const voteDays = raffle.voteDays ?? 5;
        const voteClosesAt = new Date(now + voteDays * 86400000).toISOString();
        await admin
          .from("engagements")
          .update({
            status: "revealed",
            config: {
              ...((e.config as Record<string, unknown>) ?? {}),
              raffle: { ...raffle, voteClosesAt },
            },
          })
          .eq("id", e.id);
        revealed++;
        continue;
      }
      // Not revealed yet (gate unmet, before the deadline) → fall through to the
      // standard nudge logic. The generic reveal blocks below are no-ops here
      // because now < dl whenever a raffle reaches this point.
    }

    // "Hold until deadline" engagements reveal AT the deadline regardless of how
    // many responded — that's the whole point of waiting for the date.
    if (!isSignupEng && e.hold_until_deadline && now >= dl) {
      await admin.from("engagements").update({ status: "revealed" }).eq("id", e.id);
      revealed++;
      continue;
    }

    // Past the grace window → reveal with whoever's in, so it never freezes.
    if (!isSignupEng && now > dl + GRACE_MS) {
      await admin.from("engagements").update({ status: "revealed" }).eq("id", e.id);
      revealed++;
      continue;
    }

    // Within the window (~2 days before the deadline through grace): nudge the
    // people we can reach — non-responding members + still-pending invitees.
    // Throttled to ~once a day, so they get a heads-up 1–2 days out.
    if (now > dl - NUDGE_LEAD_MS) {
      const lastNudge = e.deadline_nudged_at
        ? new Date(e.deadline_nudged_at as string).getTime()
        : 0;
      if (now - lastNudge < NUDGE_THROTTLE_MS) continue;

      const { count } = await admin
        .from("responses")
        .select("*", { count: "exact", head: true })
        .eq("engagement_id", e.id);
      const memberEmails = await getNonResponderEmails(admin, e.id as string, e.group_id as string);
      const { data: pend } = await admin
        .from("campfire_invitations")
        .select("email")
        .eq("group_id", e.group_id)
        .eq("status", "pending")
        // Whole-group invites only — engagement-scoped guests get a card-specific
        // flow, not the group join nudge.
        .is("engagement_id", null);
      const { data: group } = await admin
        .from("groups")
        .select("name, invite_code, avatar_emoji")
        .eq("id", e.group_id)
        .single();

      const engUrl = `${base}/campfirelive/group/${e.group_id}/engagement/${e.id}`;
      const messages: {
        from: string;
        to: string[];
        subject: string;
        text: string;
        html: string;
      }[] = [];

      if (memberEmails.length) {
        const m = reminderEmail({
          groupName: group?.name ?? "your group",
          title: resolveTitle(
            e.title as string,
            e.birth_year as number | null,
            e.deadline as string | null
          ),
          url: engUrl,
          responded: count ?? 0,
          total: (e.total_expected as number) ?? 0,
          // Within the last day it becomes an urgent "final call".
          hoursLeft: Math.max(0, Math.round((dl - now) / (60 * 60 * 1000))),
        });
        for (const to of memberEmails) {
          messages.push({ from, to: [to], subject: m.subject, text: m.text, html: m.html, ...mailDefaults() });
        }
      }
      if (pend?.length && group) {
        const joinUrl = buildJoinUrl(base, group.invite_code);
        const inv = inviteEmail({
          inviter: "Your group",
          groupName: group.name,
          groupEmoji: group.avatar_emoji,
          inviteCode: group.invite_code,
          joinUrl,
          nudge: true,
        });
        for (const p of pend) {
          messages.push({ from, to: [p.email], subject: inv.subject, text: inv.text, html: inv.html, ...mailDefaults() });
        }
      }

      if (messages.length) {
        // Resend batch caps at 100; chunk to be safe.
        for (let i = 0; i < messages.length; i += 100) {
          await resend.batch.send(messages.slice(i, i + 100));
        }
        await admin
          .from("engagements")
          .update({ deadline_nudged_at: new Date(now).toISOString() })
          .eq("id", e.id);
        nudged++;
      }
    }
  }

  // ── Raffle auto-award: voting window closed → pay the voted winner ──
  let awarded = 0;
  // Not filtered on gift_enabled: a raffle's pot is intrinsic (older cards may not
  // have the flag set). The raffleOf() check below gates which rows actually award.
  const { data: raffleEngs } = await admin
    .from("engagements")
    .select("id, group_id, creator_id, title, config, gift_currency, gift_enabled")
    .eq("status", "revealed")
    .is("gift_issued_at", null);
  for (const e of raffleEngs ?? []) {
    const raffle = raffleOf(e.config as Record<string, unknown> | null);
    if (!raffle?.voteClosesAt) continue;
    if (new Date(raffle.voteClosesAt).getTime() > now) continue; // still voting

    // Raffle Draw: no entries/votes. Auto-draw at the close if the host opted in;
    // otherwise wait for them to draw it live at the event.
    if (raffle.draw) {
      if (raffle.autoDraw !== false) {
        const r = await runRaffleDraw(admin, {
          id: e.id as string,
          group_id: e.group_id as string,
          creator_id: e.creator_id as string,
          title: e.title as string,
          config: e.config as Record<string, unknown> | null,
          gift_currency: e.gift_currency as string | null,
          gift_issued_at: null,
        });
        if (r.ok) awarded++;
      }
      continue;
    }

    // Entries, earliest-first so ties (and zero-vote) resolve to the earliest.
    const { data: entries } = await admin
      .from("responses")
      .select("id, user_id, created_at, content")
      .eq("engagement_id", e.id)
      .order("created_at", { ascending: true });
    if (!entries || entries.length === 0) continue; // no entries → host can cancel/refund

    // A tournament is decided by SCORE (best total), not votes — pick the winner
    // here and skip the vote tally / no-votes grace below.
    const tcfg = tournamentOf(e.config as Record<string, unknown> | null);
    let tournWinner: (typeof entries)[number] | null = null;
    if (tcfg) {
      let bestTotal: number | null = null;
      for (const r of entries) {
        const total = Number((r.content as { total?: number } | null)?.total ?? 0);
        if (
          bestTotal === null ||
          (tcfg.direction === "low" ? total < bestTotal : total > bestTotal)
        ) {
          bestTotal = total;
          tournWinner = r;
        }
      }
    }

    const { data: votes } = await admin
      .from("campfire_challenge_votes")
      .select("response_id, voter_user_id")
      .eq("engagement_id", e.id);
    // Map each entry to its author so self-votes can't count.
    const authorOf: Record<string, string> = {};
    for (const r of entries) authorOf[r.id as string] = r.user_id as string;
    const counts: Record<string, number> = {};
    for (const v of votes ?? []) {
      const rid = v.response_id as string;
      if (authorOf[rid] === (v.voter_user_id as string)) continue; // no self-votes
      counts[rid] = (counts[rid] ?? 0) + 1;
    }

    // No votes at the close → don't award arbitrarily. Nudge the group and extend
    // voting 14 days; only after that grace does it fall back to the earliest entry.
    const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!tcfg && totalVotes === 0) {
      const graceUntil = raffle.noVoteGraceUntil
        ? new Date(raffle.noVoteGraceUntil).getTime()
        : null;
      if (!graceUntil) {
        const noVoteGraceUntil = new Date(now + 14 * 86400000).toISOString();
        await admin
          .from("engagements")
          .update({
            config: {
              ...((e.config as Record<string, unknown>) ?? {}),
              raffle: { ...raffle, noVoteGraceUntil },
            },
          })
          .eq("id", e.id);
        // One nudge to vote before the prize defaults to the first entry.
        try {
          const memberEmails = await getGroupMemberEmails(admin, e.group_id as string);
          const engUrl = `${base}/campfirelive/group/${e.group_id}/engagement/${e.id}`;
          const by = new Date(now + 14 * 86400000).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
          const subject = `🗳 No votes yet — "${e.title}"`;
          const text = `Nobody's voted on "${e.title}" yet. Vote by ${by} or the prize goes to the first entry. ${engUrl}`;
          const html = `<p>🗳 Nobody's voted on "<b>${escapeHtml(
            e.title as string
          )}</b>" yet.</p><p>Vote by <b>${by}</b> or the prize defaults to the first entry.</p><p><a href="${engUrl}">Vote now →</a></p>`;
          for (let i = 0; i < memberEmails.length; i += 100) {
            await resend.batch.send(
              memberEmails.slice(i, i + 100).map((to) => ({
                from,
                to: [to],
                subject,
                text,
                html,
                ...mailDefaults(),
              }))
            );
          }
        } catch (err) {
          console.error("Raffle no-vote nudge failed:", err);
        }
        continue; // wait out the grace window
      }
      if (now < graceUntil) continue; // still in grace, hoping for votes
      // Grace expired, still zero votes → fall through, award the earliest entry.
    }

    let winner = tournWinner ?? entries[0];
    if (!tcfg) {
      let best = -1;
      for (const r of entries) {
        const c = counts[r.id as string] ?? 0;
        if (c > best) {
          best = c;
          winner = r;
        }
      }
    }
    const winnerUid = winner.user_id as string;

    // Resolve the winner's email (login email, else host-linked notify email).
    const { data: wUser } = await admin.auth.admin.getUserById(winnerUid);
    let winnerEmail = wUser?.user?.email || null;
    let winnerName =
      (wUser?.user?.user_metadata?.name as string | undefined) || undefined;
    const { data: wGm } = await admin
      .from("group_members")
      .select("notify_email, display_name")
      .eq("group_id", e.group_id)
      .eq("user_id", winnerUid)
      .maybeSingle();
    if (!winnerEmail) winnerEmail = (wGm?.notify_email as string | null) || null;
    winnerName = winnerName || (wGm?.display_name as string | undefined) || undefined;

    // Pool = paid contributions on this engagement.
    const { data: contribs } = await admin
      .from("campfire_gift_contributions")
      .select("amount_cents")
      .eq("engagement_id", e.id)
      .eq("status", "paid");
    const totalCents = (contribs ?? []).reduce(
      (a, c) => a + ((c.amount_cents as number) || 0),
      0
    );

    // Can't pay (no funds, no email, or Tremendous unconfigured) → just record the
    // winner so the UI can show it; leave it unissued and retry next run.
    if (totalCents <= 0 || !winnerEmail || !giftProviderConfigured()) {
      await admin
        .from("engagements")
        .update({
          config: {
            ...((e.config as Record<string, unknown>) ?? {}),
            raffle: { ...raffle, winnerUserId: winnerUid },
          },
        })
        .eq("id", e.id);
      continue;
    }

    const hostPct = raffle.hostSplitPct ?? 0;
    const hostCents = Math.round((totalCents * hostPct) / 100);
    const winnerCents = totalCents - hostCents;
    const currency = (e.gift_currency as string | null) ?? "usd";

    const won = await issueGiftCard({
      amountCents: winnerCents,
      currency,
      recipientEmail: winnerEmail,
      recipientName: winnerName,
      note: tcfg
        ? `You won "${e.title}"! 🏆 Best total score takes the pot.`
        : `You won "${e.title}"! 🏆 The group voted your entry the winner.`,
      idempotencyKey: `${e.id}:winner`,
    });
    if (!won.ok) {
      console.error("Raffle winner payout failed:", won.error);
      continue; // retry next run
    }
    // Host's split (if any) → the engagement creator's email.
    if (hostCents > 0) {
      const { data: hUser } = await admin.auth.admin.getUserById(
        e.creator_id as string
      );
      const hostEmail = hUser?.user?.email || null;
      if (hostEmail) {
        await issueGiftCard({
          amountCents: hostCents,
          currency,
          recipientEmail: hostEmail,
          note: `Host's ${hostPct}% share of the "${e.title}" prize pot.`,
          idempotencyKey: `${e.id}:host`,
        });
      }
    }

    await admin
      .from("engagements")
      .update({
        gift_issued_at: new Date(now).toISOString(),
        gift_recipient_email: winnerEmail,
        gift_recipient_name: winnerName ?? null,
        config: {
          ...((e.config as Record<string, unknown>) ?? {}),
          raffle: { ...raffle, winnerUserId: winnerUid },
        },
      })
      .eq("id", e.id);
    awarded++;

    // Tell the group who won.
    try {
      const memberEmails = await getGroupMemberEmails(admin, e.group_id as string);
      const engUrl = `${base}/campfirelive/group/${e.group_id}/engagement/${e.id}`;
      const pot = `${currency.toUpperCase()} $${(winnerCents / 100).toFixed(2)}`;
      const who = winnerName || "The winner";
      const subject = `🏆 We have a winner — "${e.title}"`;
      const text = `${who} won the ${pot} prize pot for "${e.title}". See the entry: ${engUrl}`;
      const html = `<p>🏆 <b>${escapeHtml(who)}</b> won the ${pot} prize pot for "${escapeHtml(
        e.title as string
      )}".</p><p><a href="${engUrl}">See the winning entry →</a></p>`;
      for (let i = 0; i < memberEmails.length; i += 100) {
        await resend.batch.send(
          memberEmails.slice(i, i + 100).map((to) => ({
            from,
            to: [to],
            subject,
            text,
            html,
            ...mailDefaults(),
          }))
        );
      }
    } catch (err) {
      console.error("Raffle winner notify failed:", err);
    }
  }

  // ── Auto-open scheduled drafts (e.g. a birthday opening 2 weeks before) ──
  let opened = 0;
  const { data: scheduled } = await admin
    .from("engagements")
    .select(
      "id, group_id, creator_id, title, type, config, is_blind, reveal, deadline, hold_until_deadline, birth_year, excluded_user_ids, excluded_emails"
    )
    .is("launched_at", null)
    .eq("paused", false) // paused → don't auto-open
    .not("scheduled_open_at", "is", null)
    .lte("scheduled_open_at", new Date(now).toISOString());

  for (const e of scheduled ?? []) {
    await admin
      .from("engagements")
      .update({ launched_at: new Date(now).toISOString() })
      .eq("id", e.id);
    opened++;

    // Email members (except the creator + any surprise recipients) to come sign it.
    const excludedEmails = new Set<string>();
    for (const uid of (e.excluded_user_ids as string[]) ?? []) {
      const { data: u } = await admin.auth.admin.getUserById(uid);
      const em = u?.user?.email?.toLowerCase();
      if (em) excludedEmails.add(em);
    }
    for (const em of (e.excluded_emails as string[]) ?? [])
      excludedEmails.add(em.toLowerCase());
    const { data: cu } = await admin.auth.admin.getUserById(e.creator_id);
    const creatorEmail = (cu?.user?.email || "").toLowerCase();
    const memEmails = (await getGroupMemberEmails(admin, e.group_id)).filter(
      (em) => em.toLowerCase() !== creatorEmail && !excludedEmails.has(em.toLowerCase())
    );

    const { data: grp } = await admin
      .from("groups")
      .select("name")
      .eq("id", e.group_id)
      .single();
    const meta = ENGAGEMENT_TYPES[e.type as keyof typeof ENGAGEMENT_TYPES];
    const engTitle = resolveTitle(
      e.title as string,
      e.birth_year as number | null,
      e.deadline as string | null
    );
    const engUrl = `${base}/campfirelive/group/${e.group_id}/engagement/${e.id}`;

    if (memEmails.length) {
      const m = newEngagementEmail({
        creator: grp?.name || "Your group",
        groupName: grp?.name || "your group",
        title: engTitle,
        typeLabel: meta?.label || "engagement",
        typeIcon: engagementIcon({
          type: e.type as string,
          config: e.config as { occasion?: string } | null,
        }),
        isBlind: !!e.is_blind,
        reveal: e.reveal as string,
        deadline: e.deadline as string | null,
        holdUntilDeadline: !!e.hold_until_deadline,
        url: engUrl,
      });
      for (let i = 0; i < memEmails.length; i += 100) {
        await resend.batch.send(
          memEmails.slice(i, i + 100).map((to) => ({
            from, to: [to], subject: m.subject, text: m.text, html: m.html, ...mailDefaults(),
          }))
        );
      }
    }

    // Notify the creator too — for a recurring card that re-opened on its own,
    // they did nothing today and need to know it's live (to sign + round people up).
    if (creatorEmail) {
      const hostMail = cardLiveEmail({
        groupName: grp?.name || "your group",
        title: engTitle,
        typeLabel: meta?.label || "engagement",
        typeIcon: engagementIcon({
          type: e.type as string,
          config: e.config as { occasion?: string } | null,
        }),
        deadline: e.deadline as string | null,
        url: engUrl,
      });
      await resend.batch.send([
        {
          from,
          to: [creatorEmail],
          subject: hostMail.subject,
          text: hostMail.text,
          html: hostMail.html,
          ...mailDefaults(),
        },
      ]);
    }
  }

  // ── Recurring: spawn the next instance for completed recurring engagements ──
  let spawned = 0;
  const { data: recs } = await admin
    .from("engagements")
    .select(
      "id, group_id, creator_id, type, title, description, config, reveal, is_blind, recurrence_rule, created_at, deadline, scheduled_open_at, lead_days, birth_year, excluded_user_ids, excluded_emails, cover_image_url, cover_image_urls"
    )
    .not("recurrence_rule", "is", null)
    .eq("paused", false) // paused → don't roll the next occurrence forward
    .in("status", ["revealed", "expired"]);

  for (const e of recs ?? []) {
    // Only the tail of a chain spawns (skip if it already has a child).
    const { count: childCount } = await admin
      .from("engagements")
      .select("*", { count: "exact", head: true })
      .eq("parent_id", e.id);
    if (childCount && childCount > 0) continue;

    const DAY = 24 * 60 * 60 * 1000;

    // Care/Accountability variety: if the host gave a question pool (alternate
    // wordings per category), lock in a fresh random pick for THIS occurrence so it
    // differs from last time. Everyone in the group still gets the same set.
    const qPool = (e.config as { questionPool?: QuestionCategory[] } | null)
      ?.questionPool;
    const spawnConfig =
      qPool && qPool.length
        ? {
            ...((e.config as Record<string, unknown>) ?? {}),
            questions: selectPoolQuestions(qPool, e.type as string),
          }
        : e.config;

    // Yearly (birthday/anniversary/holiday): re-open a lead time before next year's
    // date as a draft (the auto-open step above launches it). A fixed-date birthday
    // anchors to the same calendar day; a floating holiday (config.recurrence_nth,
    // e.g. Mother's Day = 2nd Sun May) recomputes next year's Nth-weekday date.
    if (e.recurrence_rule === "yearly") {
      const prev = new Date((e.deadline as string) ?? new Date(now).toISOString());
      const nth = (e.config as { recurrence_nth?: NthWeekday } | null)?.recurrence_nth;
      const nextDeadline = nth
        ? nthWeekdayOfMonth(
            prev.getFullYear() + 1,
            nth.week,
            nth.weekday,
            nth.month,
            prev.getHours()
          )
        : (() => {
            const d = new Date(prev);
            d.setFullYear(d.getFullYear() + 1);
            return d;
          })();
      const lead = ((e.lead_days as number) ?? 14) * DAY;
      await admin.from("engagements").insert({
        group_id: e.group_id,
        creator_id: e.creator_id,
        type: e.type,
        title: e.title,
        description: e.description,
        config: spawnConfig,
        reveal: e.reveal,
        is_blind: e.is_blind,
        recurrence_rule: "yearly",
        parent_id: e.id,
        status: "active",
        launched_at: null, // stays a draft until scheduled_open_at
        notify: true,
        hold_until_deadline: true,
        deadline: nextDeadline.toISOString(),
        scheduled_open_at: new Date(nextDeadline.getTime() - lead).toISOString(),
        lead_days: e.lead_days,
        birth_year: e.birth_year,
        excluded_user_ids: e.excluded_user_ids,
        excluded_emails: e.excluded_emails,
        cover_image_urls: e.cover_image_urls,
        // Pick a fresh random cover for this year — avoiding last year's so it
        // always changes when there are 2+ images.
        cover_image_url: (() => {
          const pool = (e.cover_image_urls as string[]) ?? [];
          if (pool.length === 0) return e.cover_image_url as string | null;
          const choices =
            pool.length > 1 ? pool.filter((u) => u !== e.cover_image_url) : pool;
          return choices[Math.floor(Math.random() * choices.length)];
        })(),
      });
      spawned++;
      continue;
    }

    // Monthly Nth-weekday release (e.g. 2nd Sunday at 4pm): roll forward to next
    // month's occurrence and spawn a DRAFT scheduled to auto-open + email then.
    const mn = (
      e.config as {
        monthlyNth?: {
          week: number;
          weekday: number;
          hour: number;
          minute: number;
          windowDays?: number;
        };
      } | null
    )?.monthlyNth;
    if (e.recurrence_rule === "monthly" && mn) {
      // Anchor a day past this instance's open so we land on the next month.
      const anchor = new Date(
        (e.scheduled_open_at as string) ?? new Date(now).toISOString()
      );
      anchor.setTime(anchor.getTime() + DAY);
      const nextOpen = nextMonthlyNthWeekday(
        mn.week,
        mn.weekday,
        mn.hour ?? 16,
        mn.minute ?? 0,
        anchor
      );
      const close = new Date(nextOpen.getTime() + (mn.windowDays ?? 3) * DAY);
      await admin.from("engagements").insert({
        group_id: e.group_id,
        creator_id: e.creator_id,
        type: e.type,
        title: e.title,
        description: e.description,
        config: spawnConfig,
        reveal: e.reveal,
        is_blind: e.is_blind,
        recurrence_rule: "monthly",
        parent_id: e.id,
        status: "active",
        launched_at: null, // draft — the auto-open step launches + emails at the time
        notify: true,
        hold_until_deadline: true,
        deadline: close.toISOString(),
        scheduled_open_at: nextOpen.toISOString(),
        excluded_user_ids: e.excluded_user_ids,
        excluded_emails: e.excluded_emails,
        cover_image_urls: e.cover_image_urls,
        cover_image_url: e.cover_image_url,
      });
      spawned++;
      continue;
    }

    const intervalMs =
      e.recurrence_rule === "weekly"
        ? 7 * DAY
        : e.recurrence_rule === "monthly"
        ? 30 * DAY
        : DAY;
    if (now < new Date(e.created_at as string).getTime() + intervalMs) continue;

    await admin.from("engagements").insert({
      group_id: e.group_id,
      creator_id: e.creator_id,
      type: e.type,
      title: e.title,
      description: e.description,
      config: spawnConfig,
      reveal: e.reveal,
      is_blind: e.is_blind,
      recurrence_rule: e.recurrence_rule,
      parent_id: e.id,
      status: "active",
      // Auto-posted, so it's live immediately (not a draft) and members see it.
      launched_at: new Date(now).toISOString(),
      notify: true,
      deadline: new Date(now + intervalMs).toISOString(),
    });
    spawned++;
  }

  // ── Reveal emails: notify members of newly-revealed engagements that opted in ──
  let notifiedReveals = 0;
  const { data: toNotify } = await admin
    .from("engagements")
    .select("id, group_id, title, birth_year, deadline, type, config, excluded_user_ids, excluded_emails")
    .eq("status", "revealed")
    .eq("paused", false) // paused → hold the reveal email too
    .is("reveal_notified_at", null);

  for (const e of toNotify ?? []) {
    // Members + invited-but-not-joined (a reveal nudge) AND the surprise recipient(s)
    // by email — at reveal the recipient SHOULD get their card.
    const memberEmails = await getGroupMemberEmails(admin, e.group_id);
    const pendingEmails = await getPendingInviteeEmails(admin, e.group_id);
    const recipientByEmail = ((e.excluded_emails as string[] | null) ?? []).map(
      (x) => x.toLowerCase()
    );
    const emails = Array.from(
      new Set([...memberEmails, ...pendingEmails, ...recipientByEmail])
    );
    if (emails.length) {
      const { data: group } = await admin
        .from("groups")
        .select("name")
        .eq("id", e.group_id)
        .single();
      const engUrl = `${base}/campfirelive/group/${e.group_id}/engagement/${e.id}`;
      const engTitle = resolveTitle(
        e.title as string,
        e.birth_year as number | null,
        e.deadline as string | null
      );

      if (e.type === "birthday") {
        // Card delivered: everyone learns the recipient got it + how many wishes.
        const { count } = await admin
          .from("responses")
          .select("*", { count: "exact", head: true })
          .eq("engagement_id", e.id);
        const { label, emails: recipientEmails } = await getCardRecipients(
          admin,
          e.group_id as string,
          (e.excluded_user_ids as string[]) ?? [],
          (e.config as { occasion?: string } | null)?.occasion
            ? "the guest of honor"
            : "The birthday person"
        );
        const recipientSet = new Set([
          ...Array.from(recipientEmails),
          ...recipientByEmail,
        ]);
        const msgs = emails.map((to) => {
          const cm = cardRevealEmail({
            groupName: group?.name ?? "your group",
            title: engTitle,
            recipientName: label,
            count: count ?? 0,
            url: engUrl,
            forRecipient: recipientSet.has(to.toLowerCase()),
            icon: engagementIcon({
              type: e.type as string,
              config: e.config as { occasion?: string } | null,
            }),
          });
          return { from, to: [to], subject: cm.subject, text: cm.text, html: cm.html, ...mailDefaults() };
        });
        for (let i = 0; i < msgs.length; i += 100) {
          await resend.batch.send(msgs.slice(i, i + 100));
        }
      } else {
        const m = revealEmail({
          groupName: group?.name ?? "your group",
          title: engTitle,
          url: engUrl,
        });
        for (let i = 0; i < emails.length; i += 100) {
          await resend.batch.send(
            emails.slice(i, i + 100).map((to) => ({
              from,
              to: [to],
              subject: m.subject,
              text: m.text,
              html: m.html,
              ...mailDefaults(),
            }))
          );
        }
      }
    }
    await admin
      .from("engagements")
      .update({ reveal_notified_at: new Date(now).toISOString() })
      .eq("id", e.id);
    notifiedReveals++;
  }

  // ── Group gifts: issue the gift card for any revealed, gift-enabled engagement
  //    that hasn't been issued yet (covers both auto and manual reveals; the
  //    external_id keeps it at-most-once even if a run overlaps). ──
  let giftsIssued = 0;
  if (giftProviderConfigured()) {
    const { data: giftEngs } = await admin
      .from("engagements")
      .select("id, title, gift_recipient_email, gift_recipient_name, gift_currency")
      .eq("gift_enabled", true)
      .eq("status", "revealed")
      .is("gift_issued_at", null)
      .not("gift_recipient_email", "is", null);
    for (const e of giftEngs ?? []) {
      const { data: contribs } = await admin
        .from("campfire_gift_contributions")
        .select("amount_cents")
        .eq("engagement_id", e.id)
        .eq("status", "paid");
      const totalCents = (contribs ?? []).reduce(
        (a, c) => a + (c.amount_cents as number),
        0
      );
      if (totalCents <= 0) continue;
      const result = await issueGiftCard({
        amountCents: totalCents,
        currency: (e.gift_currency as string | null) ?? "usd",
        recipientEmail: e.gift_recipient_email as string,
        recipientName: (e.gift_recipient_name as string | null) ?? undefined,
        note: `A group gift from everyone who signed "${e.title}" 🎉`,
        idempotencyKey: e.id as string,
      });
      if (!result.ok) {
        console.error(`Gift issue failed for ${e.id}:`, result.error);
        continue;
      }
      await admin
        .from("engagements")
        .update({
          gift_issued_at: new Date(now).toISOString(),
          gift_order_id: result.orderId ?? null,
        })
        .eq("id", e.id);
      giftsIssued++;
    }
  }

  // ── Two Truths & a Lie: reveal the lies (and crown the Best Liar) once everyone
  // has guessed, OR once the deadline passes — whichever comes first. ──
  let liesRevealed = 0;
  const { data: ttEngs } = await admin
    .from("engagements")
    .select("id, deadline")
    .eq("type", "two_truths")
    .is("lies_revealed_at", null)
    .not("launched_at", "is", null);
  for (const e of ttEngs ?? []) {
    const deadlinePassed =
      !!e.deadline && new Date(e.deadline as string).getTime() <= now;

    let everyoneIn = false;
    const { data: resp } = await admin
      .from("responses")
      .select("id, user_id")
      .eq("engagement_id", e.id);
    const R = (resp ?? []).length;
    if (R > 1) {
      const { data: guesses } = await admin
        .from("campfire_lie_guesses")
        .select("guesser_id, guess_index, response_id")
        .eq("engagement_id", e.id);
      // For each responder, how many distinct entries they've guessed the lie on.
      const guessedByUser = new Map<string, Set<string>>();
      for (const g of guesses ?? []) {
        if (g.guess_index == null) continue;
        const uid = g.guesser_id as string;
        const set = guessedByUser.get(uid) ?? new Set<string>();
        set.add(g.response_id as string);
        guessedByUser.set(uid, set);
      }
      everyoneIn = (resp ?? []).every((r) => {
        const set = guessedByUser.get(r.user_id as string);
        return !!set && set.size >= R - 1; // guessed every entry but their own
      });
    }

    if (deadlinePassed || everyoneIn) {
      await admin
        .from("engagements")
        .update({ lies_revealed_at: new Date(now).toISOString() })
        .eq("id", e.id);
      liesRevealed++;
    }
  }

  // ── Hall of Fame: award the gift-card pot to the prize award's winner once revealed ──
  let hofAwarded = 0;
  const { data: hofEngs } = await admin
    .from("engagements")
    .select("id, group_id, creator_id, title, config, gift_currency, gift_issued_at")
    .eq("type", "hall_of_fame")
    .eq("status", "revealed")
    .eq("gift_enabled", true)
    .is("gift_issued_at", null);
  for (const e of hofEngs ?? []) {
    const award = (e.config as { hofGiftAward?: number } | null)?.hofGiftAward;
    if (award === undefined || award === null) continue; // no prize configured
    const res = await awardHallOfFameGift(admin, {
      id: e.id as string,
      group_id: e.group_id as string,
      creator_id: e.creator_id as string,
      title: e.title as string,
      config: e.config as Record<string, unknown> | null,
      gift_currency: e.gift_currency as string | null,
      gift_issued_at: e.gift_issued_at as string | null,
    });
    if (res.ok) hofAwarded++;
  }

  return NextResponse.json({
    ok: true,
    revealed,
    nudged,
    opened,
    spawned,
    notifiedReveals,
    giftsIssued,
    awarded,
    liesRevealed,
    hofAwarded,
  });
}
