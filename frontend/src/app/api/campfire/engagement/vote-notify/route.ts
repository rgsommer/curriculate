import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  contestVoteEmail,
  campfireFrom,
  campfireSiteUrl,
  mailDefaults,
  sendCampfireBatch,
} from "@/lib/campfire/serverInvites";
import { pushToUsers } from "@/lib/campfire/push";
import { raffleOf, resolveTitle } from "@/lib/campfire/types";

// Called by the activity page right after someone casts a NEW vote in a contest (not
// when they change it). Lets everyone know votes are coming in:
//   • push to every member/guest except the voter, on each new vote;
//   • email to members who haven't voted yet, at most once every 12 hours per contest
//     (config.raffle.voteActivityEmailAt) — an email per vote would read as spam.
const EMAIL_EVERY_MS = 12 * 60 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const engagementId = typeof body?.engagementId === "string" ? body.engagementId : "";
    if (!engagementId) return NextResponse.json({ error: "Missing activity." }, { status: 400 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) return NextResponse.json({ error: "Not configured" }, { status: 500 });
    const admin = createClient(url, key);

    const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const { data: who } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    const voterId = who?.user?.id;
    if (!voterId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: e } = await admin
      .from("engagements")
      .select("id, group_id, title, birth_year, deadline, status, paused, config")
      .eq("id", engagementId)
      .maybeSingle();
    if (!e || e.status !== "revealed" || e.paused) return NextResponse.json({ ok: true, skipped: true });
    const cfg = (e.config as Record<string, unknown> | null) ?? {};
    const r = raffleOf(cfg) as (ReturnType<typeof raffleOf> & { voteActivityEmailAt?: string }) | null;
    if (!r?.voteClosesAt || r.draw || new Date(r.voteClosesAt).getTime() <= Date.now()) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    // The vote must really exist (stops anyone from spamming the group via this route).
    const { data: votes } = await admin
      .from("campfire_challenge_votes")
      .select("voter_user_id")
      .eq("engagement_id", engagementId);
    const voters = new Set(((votes ?? []) as { voter_user_id: string }[]).map((v) => v.voter_user_id));
    if (!voters.has(voterId)) return NextResponse.json({ ok: true, skipped: true });

    const base = campfireSiteUrl().replace(/\/$/, "");
    const engUrl = `${base}/campfirelive/group/${e.group_id}/engagement/${e.id}`;
    const title = resolveTitle(e.title as string, e.birth_year as number | null, e.deadline as string | null);
    const n = voters.size;

    const [{ data: gm }, { data: eg }] = await Promise.all([
      admin.from("group_members").select("user_id").eq("group_id", e.group_id),
      admin.from("engagement_guests").select("user_id").eq("engagement_id", e.id),
    ]);
    const everyone = Array.from(
      new Set([
        ...((gm ?? []) as { user_id: string }[]).map((m) => m.user_id),
        ...((eg ?? []) as { user_id: string }[]).map((g) => g.user_id),
      ])
    ).filter((u) => u !== voterId);

    // Push: every new vote.
    await pushToUsers(everyone, {
      title: "🗳️ A vote just came in",
      body: `"${title}" — ${n} ${n === 1 ? "vote" : "votes"} so far. Have you voted?`,
      link: `${engUrl}#vote`,
    }).catch(() => 0);

    // Email: non-voting members, throttled. Claim the slot first so near-simultaneous
    // votes can't both send.
    const last = r.voteActivityEmailAt ? new Date(r.voteActivityEmailAt).getTime() : 0;
    if (Date.now() - last >= EMAIL_EVERY_MS) {
      await admin
        .from("engagements")
        .update({ config: { ...cfg, raffle: { ...r, voteActivityEmailAt: new Date().toISOString() } } })
        .eq("id", e.id);
      const nonVoters = ((gm ?? []) as { user_id: string }[])
        .map((m) => m.user_id)
        .filter((u) => !voters.has(u));
      const emails: string[] = [];
      for (const uid of nonVoters) {
        const { data: u } = await admin.auth.admin.getUserById(uid);
        if (u?.user?.email) emails.push(u.user.email);
      }
      if (emails.length) {
        const { data: g } = await admin.from("groups").select("name").eq("id", e.group_id).single();
        const m = contestVoteEmail({
          kind: "activity",
          groupName: (g?.name as string) ?? "your group",
          title,
          url: engUrl,
          closesAt: r.voteClosesAt,
          votes: n,
          prizeText: (cfg as { prizeText?: string }).prizeText ?? null,
        });
        const from = campfireFrom();
        for (let i = 0; i < emails.length; i += 100) {
          await sendCampfireBatch(
            emails.slice(i, i + 100).map((to) => ({
              from, to: [to], subject: m.subject, text: m.text, html: m.html, ...mailDefaults(),
            }))
          );
        }
      }
    }
    return NextResponse.json({ ok: true, votes: n });
  } catch (err) {
    console.error("Campfire vote-notify error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
