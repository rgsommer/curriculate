import { NextResponse } from "next/server";
import {
  authorizeGroupRequester,
  campfireFrom,
  campfireSiteUrl,
} from "@/lib/campfire/serverInvites";
import { announceContestWinner, contestWinnerName } from "@/lib/campfire/contestAnnounce";
import { raffleOf, resolveTitle, tournamentOf } from "@/lib/campfire/types";

// Host re-sends a decided contest's winner celebration (winner) + announcement
// (everyone else) — e.g. the first one went out without the winner's name.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId = typeof body?.engagementId === "string" ? body.engagementId : "";
    if (!engagementId) return NextResponse.json({ error: "Missing activity." }, { status: 400 });

    const { createClient } = await import("@supabase/supabase-js");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) return NextResponse.json({ error: "Not configured" }, { status: 500 });
    const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
    const { data: e } = await svc
      .from("engagements")
      .select("id, group_id, creator_id, title, birth_year, deadline, config, gift_issued_at")
      .eq("id", engagementId)
      .maybeSingle();
    if (!e) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const auth = await authorizeGroupRequester(req, e.group_id as string);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (auth.requesterId !== e.creator_id)
      return NextResponse.json({ error: "Only the host can do that." }, { status: 403 });
    const { admin } = auth;

    const cfg = (e.config as Record<string, unknown> | null) ?? {};
    const r = raffleOf(cfg) as (ReturnType<typeof raffleOf> & { winnerUnpaid?: boolean }) | null;
    if (!r?.winnerUserId) return NextResponse.json({ error: "No winner has been decided yet." }, { status: 409 });

    const winnerUid = r.winnerUserId;
    const { data: wUser } = await admin.auth.admin.getUserById(winnerUid);
    const { data: wGm } = await admin
      .from("group_members")
      .select("notify_email")
      .eq("group_id", e.group_id)
      .eq("user_id", winnerUid)
      .maybeSingle();
    const winnerEmail = wUser?.user?.email || (wGm?.notify_email as string | null) || null;
    const winnerName = await contestWinnerName(admin, e.group_id as string, winnerUid);
    // What actually happened with any money: auto-paid, waiting on the host, or none.
    // (The unpaid path stamps winnerUnpaid true/false; only an auto-payout leaves it unset.)
    const prize: "paid" | "pending" | "none" =
      r.winnerUnpaid === true ? "pending" : r.winnerUnpaid === false || !e.gift_issued_at ? "none" : "paid";

    const { sent } = await announceContestWinner(admin, {
      base: campfireSiteUrl().replace(/\/$/, ""),
      from: campfireFrom(),
      e: {
        id: e.id as string,
        group_id: e.group_id as string,
        title: resolveTitle(e.title as string, e.birth_year as number | null, e.deadline as string | null),
      },
      winnerUid,
      winnerEmail,
      winnerName,
      prize,
      byScore: !!tournamentOf(cfg),
      prizeText: (cfg as { prizeText?: string }).prizeText ?? null,
    });
    return NextResponse.json({ ok: true, sent, winnerName: winnerName ?? null });
  } catch (err) {
    console.error("Campfire announce-winner error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
