import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import {
  campfireFrom,
  mailDefaults,
  campfireSiteUrl,
  cardThanksEmail,
  getGroupMemberEmails,
  getCardRecipients,
} from "@/lib/campfire/serverInvites";
import { engagementIcon } from "@/lib/campfire/types";
import { sendCampfireBatch } from "@/lib/campfire/serverInvites";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// The card's recipient thanks everyone who signed. Emails the group (minus the
// recipient) and records config.thanksSentAt so the button flips to a done-state.
// Only the recipient may trigger it; once-only.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId =
      typeof body?.engagementId === "string" ? body.engagementId : "";
    const message =
      typeof body?.message === "string" ? body.message.slice(0, 280) : "";
    if (!engagementId) {
      return NextResponse.json({ error: "Missing engagement." }, { status: 400 });
    }
    const admin = getAdmin();
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: e } = await admin
      .from("engagements")
      .select(
        "id, group_id, title, type, config, excluded_user_ids, birth_year, deadline"
      )
      .eq("id", engagementId)
      .single();
    if (!e) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const excluded = (e.excluded_user_ids as string[]) ?? [];
    if (!excluded.includes(uid)) {
      return NextResponse.json(
        { error: "Only the recipient can send thanks." },
        { status: 403 }
      );
    }
    const cfg = (e.config ?? {}) as Record<string, unknown>;
    if (cfg.thanksSentAt) {
      return NextResponse.json({ ok: true, alreadySent: true });
    }

    // Stamp first (so a double-tap can't double-send), then email.
    await admin
      .from("engagements")
      .update({
        config: {
          ...cfg,
          thanksSentAt: new Date().toISOString(),
          thanksMessage: message || null,
        },
      })
      .eq("id", engagementId);

    const { data: group } = await admin
      .from("groups")
      .select("name")
      .eq("id", e.group_id)
      .single();
    const { label, emails: recipientEmails } = await getCardRecipients(
      admin,
      e.group_id as string,
      excluded,
      "Your group member"
    );
    const all = await getGroupMemberEmails(admin, e.group_id as string);
    // Everyone who signed, minus the recipient themselves.
    const to = all.filter((em) => !recipientEmails.has(em.toLowerCase()));
    if (to.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    const base = campfireSiteUrl();
    const url = `${base}/campfirelive/group/${e.group_id}/engagement/${engagementId}`;
    const from = campfireFrom();
    const em = cardThanksEmail({
      recipientName: label,
      groupName: group?.name ?? "your group",
      message,
      url,
      icon: engagementIcon({
        type: e.type as string,
        config: e.config as { occasion?: string } | null,
      }),
    });
    const msgs = to.map((addr) => ({
      from,
      to: [addr],
      subject: em.subject,
      text: em.text,
      html: em.html,
      ...mailDefaults(),
    }));
    let sent = 0;
    for (let i = 0; i < msgs.length; i += 100) {
      const { error } = await sendCampfireBatch(msgs.slice(i, i + 100));
      if (error) {
        console.error("Card thanks send error:", error);
        break;
      }
      sent += msgs.slice(i, i + 100).length;
    }
    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    console.error("Card thanks error:", e);
    return NextResponse.json({ error: "Failed to send thanks." }, { status: 500 });
  }
}
