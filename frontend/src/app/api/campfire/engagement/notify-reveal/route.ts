import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import {
  authorizeGroupRequester,
  getGroupMemberEmails,
  getCardRecipients,
  revealEmail,
  cardRevealEmail,
  campfireFrom,
  mailDefaults,
} from "@/lib/campfire/serverInvites";
import { resolveTitle, engagementIcon } from "@/lib/campfire/types";

const resend = new Resend(process.env.RESEND_API_KEY);

// Email the results of a just-revealed engagement to members who have an email
// (anonymous/guest members have none, so they're naturally skipped). Idempotent:
// the first caller claims reveal_notified_at, so concurrent viewers send once.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId = typeof body?.engagementId === "string" ? body.engagementId : "";
    const originIn = typeof body?.origin === "string" ? body.origin : "";
    if (!engagementId) {
      return NextResponse.json({ error: "Missing engagement." }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json({ error: "Server not configured." }, { status: 500 });
    }
    const svc = createClient(url, serviceKey);
    const { data: eng } = await svc
      .from("engagements")
      .select("id, group_id, title, status, reveal_notified_at, birth_year, deadline, type, config, excluded_user_ids")
      .eq("id", engagementId)
      .single();
    if (!eng) {
      return NextResponse.json({ error: "Engagement not found." }, { status: 404 });
    }
    if (eng.status !== "revealed") {
      return NextResponse.json({ ok: true, skipped: "not revealed" });
    }

    // Must be a member of the group to trigger this.
    const auth = await authorizeGroupRequester(req, eng.group_id);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin } = auth;

    if (eng.reveal_notified_at) {
      return NextResponse.json({ ok: true, skipped: "already sent" });
    }

    // Claim the lock: only the row update that flips null → now() wins.
    const { data: claimed } = await admin
      .from("engagements")
      .update({ reveal_notified_at: new Date().toISOString() })
      .eq("id", engagementId)
      .is("reveal_notified_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ ok: true, skipped: "already sent" });
    }

    const emails = await getGroupMemberEmails(admin, eng.group_id);
    if (emails.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    const base = (/^https:\/\/([a-z0-9-]+\.)?curriculate\.net$/.test(originIn)
      ? originIn
      : process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net"
    ).replace(/\/$/, "");
    const { data: group } = await admin
      .from("groups")
      .select("name")
      .eq("id", eng.group_id)
      .single();
    const from = campfireFrom();
    const engUrl = `${base}/campfirelive/group/${eng.group_id}/engagement/${engagementId}`;
    const engTitle = resolveTitle(
      eng.title,
      eng.birth_year as number | null,
      eng.deadline as string | null
    );

    // Birthday card: the wishes are private to the recipient, but everyone learns
    // the card was delivered + how many wishes — recipient gets a tailored note.
    if (eng.type === "birthday") {
      const { count } = await admin
        .from("responses")
        .select("*", { count: "exact", head: true })
        .eq("engagement_id", engagementId);
      const { label, emails: recipientEmails } = await getCardRecipients(
        admin,
        eng.group_id,
        (eng.excluded_user_ids as string[]) ?? []
      );
      const msgs = emails.map((to) => {
        const m = cardRevealEmail({
          groupName: group?.name ?? "your group",
          title: engTitle,
          recipientName: label,
          count: count ?? 0,
          url: engUrl,
          forRecipient: recipientEmails.has(to.toLowerCase()),
          icon: engagementIcon({
            type: eng.type as string,
            config: eng.config as { occasion?: string } | null,
          }),
        });
        return { from, to: [to], subject: m.subject, text: m.text, html: m.html, ...mailDefaults() };
      });
      for (let i = 0; i < msgs.length; i += 100) {
        await resend.batch.send(msgs.slice(i, i + 100));
      }
      return NextResponse.json({ ok: true, sent: emails.length, card: true });
    }

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

    return NextResponse.json({ ok: true, sent: emails.length });
  } catch (err) {
    console.error("Campfire notify-reveal error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
