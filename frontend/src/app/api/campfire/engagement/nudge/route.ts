import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import {
  authorizeGroupRequester,
  getNonResponderEmails,
  reminderEmail,
  mailDefaults,
  campfireFrom,
} from "@/lib/campfire/serverInvites";
import { resolveTitle } from "@/lib/campfire/types";

const resend = new Resend(process.env.RESEND_API_KEY);

// Manual: a member emails a reminder to everyone who hasn't responded yet.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId = typeof body?.engagementId === "string" ? body.engagementId : "";
    if (!engagementId) {
      return NextResponse.json({ error: "Missing engagement." }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json({ error: "Server not configured." }, { status: 500 });
    }

    // Look up the engagement (group, title, count) to authorize against its group.
    const svc = createClient(url, serviceKey);
    const { data: eng } = await svc
      .from("engagements")
      .select("group_id, title, total_expected, birth_year, deadline")
      .eq("id", engagementId)
      .single();
    if (!eng) {
      return NextResponse.json({ error: "Engagement not found." }, { status: 404 });
    }

    const auth = await authorizeGroupRequester(req, eng.group_id);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin } = auth;

    const emails = await getNonResponderEmails(admin, engagementId, eng.group_id);
    if (emails.length === 0) {
      return NextResponse.json({ ok: true, nudged: 0 });
    }

    const { count } = await admin
      .from("responses")
      .select("*", { count: "exact", head: true })
      .eq("engagement_id", engagementId);
    const { data: group } = await admin
      .from("groups")
      .select("name")
      .eq("id", eng.group_id)
      .single();

    const base = process.env.NEXT_PUBLIC_SITE_URL || "https://www.curriculate.net";
    const engUrl = `${base}/campfirelive/group/${eng.group_id}/engagement/${engagementId}`;
    const from = campfireFrom();
    const m = reminderEmail({
      groupName: group?.name ?? "your group",
      title: resolveTitle(
        eng.title,
        eng.birth_year as number | null,
        eng.deadline as string | null
      ),
      url: engUrl,
      responded: count ?? 0,
      total: eng.total_expected ?? 0,
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

    return NextResponse.json({ ok: true, nudged: emails.length });
  } catch (err) {
    console.error("Campfire engagement nudge error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
