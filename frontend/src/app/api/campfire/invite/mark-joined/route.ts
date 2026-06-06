import { NextResponse } from "next/server";
import { authorizeGroupRequester } from "@/lib/campfire/serverInvites";

// Host manually marks invitations as joined. Useful when someone joined under a
// different email than they were invited at (or via the code, which carries no
// email), so the automatic email-match couldn't link them.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";
    const emails: string[] = Array.isArray(body?.emails)
      ? body.emails.map((e: unknown) => String(e).trim().toLowerCase())
      : [];

    if (!groupId || emails.length === 0) {
      return NextResponse.json({ error: "Missing group or emails." }, { status: 400 });
    }

    const auth = await authorizeGroupRequester(req, groupId, { requireAdmin: true });
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin } = auth;

    const { data, error } = await admin
      .from("campfire_invitations")
      .update({ status: "joined", joined_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .in("email", emails)
      .neq("status", "joined")
      .select("id");
    if (error) {
      console.error("Campfire mark-joined error:", error);
      return NextResponse.json({ error: "Couldn't update." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, joined: data?.length ?? 0 });
  } catch (err) {
    console.error("Campfire mark-joined route error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
