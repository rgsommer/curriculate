import { NextResponse } from "next/server";
import { authorizeGroupRequester } from "@/lib/campfire/serverInvites";

// Link a guest member (joined via the link, no login email) to the email they were
// invited at. Stores a notify-email on their membership so all Campfire emails —
// including a surprise-card reveal — reach them, and marks the invite joined. Host
// only.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";
    const userId = typeof body?.userId === "string" ? body.userId : "";
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!groupId || !userId || !email) {
      return NextResponse.json(
        { error: "Missing group, member, or email." },
        { status: 400 }
      );
    }

    const auth = await authorizeGroupRequester(req, groupId, { requireAdmin: true });
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { admin } = auth;

    // The member must belong to this group.
    const { data: gm } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!gm) {
      return NextResponse.json({ error: "Not a member of this group." }, { status: 404 });
    }

    const { error: e1 } = await admin
      .from("group_members")
      .update({ notify_email: email })
      .eq("group_id", groupId)
      .eq("user_id", userId);
    if (e1) {
      console.error("link-guest notify_email error:", e1);
      return NextResponse.json({ error: "Couldn't link." }, { status: 500 });
    }

    // Mark the matching invite joined (so the count reconciles).
    await admin
      .from("campfire_invitations")
      .update({ status: "joined", joined_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .eq("email", email)
      .neq("status", "joined");

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Campfire link-guest route error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
