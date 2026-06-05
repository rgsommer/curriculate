import { NextResponse } from "next/server";
import { authorizeGroupRequester } from "@/lib/campfire/serverInvites";

// Called right after a user joins via an email-invite link (which carries the
// invited address as ?inv=…). Marks that specific invitation joined even if the
// person signed in with a different email than they were invited at.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!groupId || !email) {
      return NextResponse.json({ error: "Missing group or email." }, { status: 400 });
    }

    const auth = await authorizeGroupRequester(req, groupId);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin } = auth;

    const { data } = await admin
      .from("campfire_invitations")
      .update({ status: "joined", joined_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .eq("email", email)
      .neq("status", "joined")
      .select("id");

    return NextResponse.json({ ok: true, matched: data?.length ?? 0 });
  } catch (err) {
    console.error("Campfire invite accept error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
