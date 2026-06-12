import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { aiConfigured, chatAnswer } from "@/app/api/_ai";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// AI: given the party context + what's already on a Sign-up list (and how much is
// claimed), suggest the items still needed — including disposables sized to the
// headcount when the host wants them. Host-only.
export async function POST(req: Request) {
  try {
    if (!aiConfigured()) {
      return NextResponse.json({ error: "AI isn't set up yet." }, { status: 503 });
    }
    const body = await req.json().catch(() => null);
    const engagementId =
      typeof body?.engagementId === "string" ? body.engagementId : "";
    if (!engagementId) {
      return NextResponse.json({ error: "Missing engagement." }, { status: 400 });
    }
    const admin = getAdmin();
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { data: eng } = await admin
      .from("engagements")
      .select("creator_id, type, config")
      .eq("id", engagementId)
      .single();
    if (!eng || eng.type !== "signup") {
      return NextResponse.json({ error: "Not a sign-up." }, { status: 400 });
    }
    if (eng.creator_id !== uid) {
      return NextResponse.json({ error: "Only the host can do that." }, { status: 403 });
    }

    const cfg = (eng.config ?? {}) as {
      slots?: { label: string; capacity: number }[];
      partyKind?: string;
      partyTheme?: string;
      headcount?: number;
      disposables?: boolean;
    };
    const slots = cfg.slots ?? [];

    // Tally claims per slot so the AI knows what's still open.
    const { data: resps } = await admin
      .from("responses")
      .select("content")
      .eq("engagement_id", engagementId);
    const claimedCount: Record<number, number> = {};
    for (const r of resps ?? []) {
      const claims = (r.content as { claims?: number[] })?.claims ?? [];
      for (const i of claims) claimedCount[i] = (claimedCount[i] ?? 0) + 1;
    }
    const listText = slots
      .map(
        (s, i) =>
          `- ${s.label} (${claimedCount[i] ?? 0}/${s.capacity} claimed)`
      )
      .join("\n");

    const system =
      "You help a host plan a group party sign-up list. Given the party type, theme/" +
      "cuisine, headcount, whether disposable tableware is used, and the items already " +
      "on the list (with how many are claimed), suggest the ADDITIONAL items still " +
      "needed so the party is well covered. When a theme or cuisine is given, suggest " +
      "dishes that fit it (e.g. a traditional Thanksgiving → turkey, stuffing, mashed " +
      "potatoes, cranberry sauce, pumpkin pie); if the theme is open-ended or asks for " +
      "ideas, propose a sensible, crowd-pleasing menu. Include practical essentials " +
      "(plates, cups, cutlery, napkins, serving utensils, ice, trash bags) sized to the " +
      "headcount ONLY when disposables are in use. Do NOT duplicate items already on the " +
      "list. Keep labels short. Return ONLY a JSON array of objects " +
      '{"label": string, "capacity": number}, at most 10 items, capacity = how many ' +
      "people should bring that item (usually 1).";
    const user =
      `Party type: ${cfg.partyKind || "unspecified"}\n` +
      `Theme / cuisine: ${cfg.partyTheme || "unspecified"}\n` +
      `Headcount: ${cfg.headcount || "unspecified"}\n` +
      `Disposable tableware wanted: ${cfg.disposables ? "yes" : "no"}\n\n` +
      `Items already on the list:\n${listText || "(none yet)"}\n\n` +
      "Suggest what's still needed as a JSON array.";

    const raw = await chatAnswer(system, [{ role: "user", content: user }]);
    const match = raw.match(/\[[\s\S]*\]/);
    let suggestions: { label: string; capacity: number }[] = [];
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as { label?: string; capacity?: number }[];
        const existing = new Set(slots.map((s) => s.label.trim().toLowerCase()));
        suggestions = parsed
          .filter((p) => p?.label && !existing.has(String(p.label).trim().toLowerCase()))
          .slice(0, 10)
          .map((p) => ({
            label: String(p.label).slice(0, 60),
            capacity: Math.max(1, Math.min(50, Math.round(Number(p.capacity) || 1))),
          }));
      } catch {
        /* fall through with empty suggestions */
      }
    }
    return NextResponse.json({ ok: true, suggestions });
  } catch (e) {
    console.error("Signup suggest error:", e);
    return NextResponse.json({ error: "Suggestion failed." }, { status: 500 });
  }
}
