import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authorizeGroupRequester } from "@/lib/campfire/serverInvites";

// When a host converts a multiple-choice poll to open-ended, each existing vote is
// stored as { option }, which the open-poll view (text answers) wouldn't show. This
// carries every option over as a text answer so nothing disappears. RLS won't let the
// host edit other members' responses, so this runs with the service role after we
// confirm the caller is the engagement's creator.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId =
      typeof body?.engagementId === "string" ? body.engagementId : "";
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
      .select("group_id, creator_id, type")
      .eq("id", engagementId)
      .single();
    if (!eng) {
      return NextResponse.json({ error: "Engagement not found." }, { status: 404 });
    }
    if (eng.type !== "poll") {
      return NextResponse.json({ error: "Not a poll." }, { status: 400 });
    }

    const auth = await authorizeGroupRequester(req, eng.group_id as string);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (auth.requesterId !== eng.creator_id) {
      return NextResponse.json(
        { error: "Only the host can convert this poll." },
        { status: 403 }
      );
    }
    const { admin } = auth;

    const { data: resps } = await admin
      .from("responses")
      .select("id, content")
      .eq("engagement_id", engagementId);

    let migrated = 0;
    for (const r of resps ?? []) {
      const content = (r.content ?? {}) as Record<string, unknown>;
      const opt = content.option;
      const hasText =
        typeof content.text === "string" && content.text.trim().length > 0;
      if (typeof opt === "string" && opt && !hasText) {
        const { error } = await admin
          .from("responses")
          .update({ content: { ...content, text: opt } })
          .eq("id", r.id);
        if (!error) migrated++;
      }
    }

    return NextResponse.json({ ok: true, migrated });
  } catch {
    return NextResponse.json({ error: "Conversion failed." }, { status: 500 });
  }
}
