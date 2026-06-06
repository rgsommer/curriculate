import { NextResponse } from "next/server";
import { authorizeGroupRequester } from "@/lib/campfire/serverInvites";

// Revoke pending invitations (they can no longer be tracked/nudged; the join
// link itself is the group's shared code, so this is about the tracked list).
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
      .update({ status: "revoked" })
      .eq("group_id", groupId)
      .in("email", emails)
      .eq("status", "pending")
      .select("id");
    if (error) {
      console.error("Campfire revoke error:", error);
      return NextResponse.json({ error: "Couldn't revoke." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, revoked: data?.length ?? 0 });
  } catch (err) {
    console.error("Campfire revoke route error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
