import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
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
} from "@/lib/campfire/serverInvites";
import { ENGAGEMENT_TYPES, resolveTitle, engagementIcon, nthWeekdayOfMonth, type NthWeekday } from "@/lib/campfire/types";

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
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net";
  const from = campfireFrom();
  const now = Date.now();

  const { data: engs } = await admin
    .from("engagements")
    .select("id, group_id, title, total_expected, deadline, reveal, deadline_nudged_at, hold_until_deadline, birth_year")
    .eq("status", "active")
    .not("deadline", "is", null);

  let revealed = 0;
  let nudged = 0;

  for (const e of engs ?? []) {
    const dl = new Date(e.deadline as string).getTime();

    // "Hold until deadline" engagements reveal AT the deadline regardless of how
    // many responded — that's the whole point of waiting for the date.
    if (e.hold_until_deadline && now >= dl) {
      await admin.from("engagements").update({ status: "revealed" }).eq("id", e.id);
      revealed++;
      continue;
    }

    // Past the grace window → reveal with whoever's in, so it never freezes.
    if (now > dl + GRACE_MS) {
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

  // ── Auto-open scheduled drafts (e.g. a birthday opening 2 weeks before) ──
  let opened = 0;
  const { data: scheduled } = await admin
    .from("engagements")
    .select(
      "id, group_id, creator_id, title, type, config, is_blind, reveal, deadline, hold_until_deadline, birth_year, excluded_user_ids, excluded_emails"
    )
    .is("launched_at", null)
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
      "id, group_id, creator_id, type, title, description, config, reveal, is_blind, recurrence_rule, created_at, deadline, lead_days, birth_year, excluded_user_ids, excluded_emails, cover_image_url, cover_image_urls"
    )
    .not("recurrence_rule", "is", null)
    .in("status", ["revealed", "expired"]);

  for (const e of recs ?? []) {
    // Only the tail of a chain spawns (skip if it already has a child).
    const { count: childCount } = await admin
      .from("engagements")
      .select("*", { count: "exact", head: true })
      .eq("parent_id", e.id);
    if (childCount && childCount > 0) continue;

    const DAY = 24 * 60 * 60 * 1000;

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
        config: e.config,
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
      config: e.config,
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
    .select("id, group_id, title, birth_year, deadline, type, config, excluded_user_ids")
    .eq("status", "revealed")
    .is("reveal_notified_at", null);

  for (const e of toNotify ?? []) {
    const emails = await getGroupMemberEmails(admin, e.group_id);
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
        const msgs = emails.map((to) => {
          const cm = cardRevealEmail({
            groupName: group?.name ?? "your group",
            title: engTitle,
            recipientName: label,
            count: count ?? 0,
            url: engUrl,
            forRecipient: recipientEmails.has(to.toLowerCase()),
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

  return NextResponse.json({ ok: true, revealed, nudged, opened, spawned, notifiedReveals });
}
