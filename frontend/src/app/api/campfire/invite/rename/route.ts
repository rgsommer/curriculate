import { NextResponse } from "next/server";
import { authorizeGroupRequester } from "@/lib/campfire/serverInvites";

// Host edits the display name attached to a tracked invitation (e.g. fix a typo,
// or add a name to an email-only invite). Only the name changes; the invite's
// email / status / nudge history are untouched.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const raw = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
    const name = raw.length > 0 ? raw : null; // empty clears the name

    if (!groupId || !email) {
      return NextResponse.json(
        { error: "Missing group or email." },
        { status: 400 }
      );
    }

    const auth = await authorizeGroupRequester(req, groupId, { requireAdmin: true });
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin } = auth;

    const { data, error } = await admin
      .from("campfire_invitations")
      .update({ name })
      .eq("group_id", groupId)
      .eq("email", email)
      .select("id");
    if (error) {
      console.error("Campfire invite rename error:", error);
      return NextResponse.json({ error: "Couldn't update." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, updated: data?.length ?? 0 });
  } catch (err) {
    console.error("Campfire invite rename route error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
