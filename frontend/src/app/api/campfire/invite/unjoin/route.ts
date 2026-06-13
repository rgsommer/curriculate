import { NextResponse } from "next/server";
import { authorizeGroupRequester } from "@/lib/campfire/serverInvites";

// Revert a wrongly-marked "joined" invite back to pending (e.g. the host marked the
// wrong person joined). NOTE: the DB reconcile trigger re-marks it joined if a real
// member with that email actually exists — so un-join only "sticks" when nobody
// really joined under that address, which is exactly the mistake case. Host only.
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
      .update({ status: "pending", joined_at: null })
      .eq("group_id", groupId)
      .in("email", emails)
      .eq("status", "joined")
      .select("id, status");
    if (error) {
      console.error("Campfire unjoin error:", error);
      return NextResponse.json({ error: "Couldn't update." }, { status: 500 });
    }
    // If the trigger re-joined it (a real member has that email), report that.
    const stillJoined = (data ?? []).filter((r) => r.status === "joined").length;
    return NextResponse.json({
      ok: true,
      reverted: (data?.length ?? 0) - stillJoined,
      reJoined: stillJoined,
    });
  } catch (err) {
    console.error("Campfire unjoin route error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
