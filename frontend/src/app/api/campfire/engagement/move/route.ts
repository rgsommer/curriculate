import { NextResponse } from "next/server";
import { authorizeGroupRequester } from "@/lib/campfire/serverInvites";

// Move an activity to another group — for when it was made in the wrong one.
//
// Who: the activity's creator or a host of its current group, who must ALSO host the
// destination group (you can't push an activity into someone else's group).
// When: only before anyone has responded. Responders belong to the old group, so moving
// later would lock them out of what they wrote.
// What moves: the activity itself plus its activity-scoped invitations (the only other
// table keyed by both engagement and group). Short links, guests, cover images and the
// schedule all follow the activity automatically.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId = typeof body?.engagementId === "string" ? body.engagementId : "";
    const targetGroupId = typeof body?.targetGroupId === "string" ? body.targetGroupId : "";
    if (!engagementId || !targetGroupId) {
      return NextResponse.json({ error: "Missing activity or group." }, { status: 400 });
    }

    // Destination first: must be a host there (this also authenticates the caller).
    const target = await authorizeGroupRequester(req, targetGroupId, { requireAdmin: true });
    if ("error" in target) {
      return NextResponse.json(
        { error: target.status === 403 ? "You can only move it into a group you host." : target.error },
        { status: target.status }
      );
    }
    const { admin, requesterId } = target;

    const { data: eng } = await admin
      .from("engagements")
      .select("id, group_id, creator_id")
      .eq("id", engagementId)
      .maybeSingle();
    if (!eng) return NextResponse.json({ error: "Activity not found." }, { status: 404 });
    if (eng.group_id === targetGroupId) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    // Source: the creator, or a host of the group it's in now.
    if (eng.creator_id !== requesterId) {
      const { data: m } = await admin
        .from("group_members")
        .select("role")
        .eq("group_id", eng.group_id)
        .eq("user_id", requesterId)
        .maybeSingle();
      if (m?.role !== "admin") {
        return NextResponse.json(
          { error: "Only the person who made it (or the group's host) can move it." },
          { status: 403 }
        );
      }
    }

    const { count } = await admin
      .from("responses")
      .select("*", { count: "exact", head: true })
      .eq("engagement_id", engagementId);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            "Someone has already responded, so it can't be moved — they'd lose access to what they wrote. Make a fresh copy in the other group instead.",
        },
        { status: 409 }
      );
    }

    const { error: ue } = await admin
      .from("engagements")
      .update({ group_id: targetGroupId })
      .eq("id", engagementId);
    if (ue) return NextResponse.json({ error: "Couldn't move it." }, { status: 500 });

    await admin
      .from("campfire_invitations")
      .update({ group_id: targetGroupId })
      .eq("engagement_id", engagementId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Campfire move engagement error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
