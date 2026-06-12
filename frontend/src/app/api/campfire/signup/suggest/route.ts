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
      slots?: { label: string; capacity: number; need?: number }[];
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
    const extras: string[] = [];
    for (const r of resps ?? []) {
      const content = r.content as { claims?: number[]; extras?: string[] };
      for (const i of content?.claims ?? [])
        claimedCount[i] = (claimedCount[i] ?? 0) + 1;
      for (const x of content?.extras ?? []) if (x) extras.push(x);
    }
    const listText = [
      ...slots.map(
        (s, i) =>
          `- ${s.label} (${claimedCount[i] ?? 0} signed up so far${
            s.capacity ? `, current cap ${s.capacity}` : ", any number"
          })`
      ),
      // Items members already said they're bringing on their own.
      ...extras.map((x) => `- ${x} (a member is bringing this)`),
    ].join("\n");

    const system =
      "You plan a BALANCED party sign-up so it's well-stocked without over-supply — a " +
      "dinner must not end up all salads and no mains, and you don't want 6 people " +
      "bringing pop. Given the party type, theme/cuisine, headcount, disposables, and " +
      "the current list (with how many have signed up for each), output a plan covering " +
      "the items already listed PLUS any essentials that are missing. For EACH item give:\n" +
      "- need: how many people SHOULD bring it for this headcount (the target). Mains/" +
      "entrees get a higher need than sides/salads; one item like a cake needs just 1.\n" +
      "- max: a sensible hard cap beyond which more is pointless (always ≥ need). For " +
      "drinks/snacks max can be a bit above need (extra is fine); for mains keep it tight.\n" +
      "When a theme/cuisine is given, suggest dishes that fit it; if open-ended, propose a " +
      "crowd-pleasing menu. Include tableware (plates/cups/cutlery/napkins) sized to the " +
      "headcount ONLY when disposables are used. Match existing labels EXACTLY when you " +
      "mean an item already on the list. Keep labels short. Return ONLY a JSON array of " +
      '{"label": string, "need": number, "max": number}, at most 14 items.';
    const user =
      `Party type: ${cfg.partyKind || "unspecified"}\n` +
      `Theme / cuisine: ${cfg.partyTheme || "unspecified"}\n` +
      `Headcount: ${cfg.headcount || "unspecified"}\n` +
      `Disposable tableware wanted: ${cfg.disposables ? "yes" : "no"}\n\n` +
      `Current list:\n${listText || "(none yet)"}\n\n` +
      "Return the balanced plan as a JSON array.";

    const raw = await chatAnswer(system, [{ role: "user", content: user }]);
    const match = raw.match(/\[[\s\S]*\]/);
    let plan: { label: string; need: number; max: number }[] = [];
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as {
          label?: string;
          need?: number;
          max?: number;
        }[];
        plan = parsed
          .filter((p) => p?.label)
          .slice(0, 14)
          .map((p) => {
            const need = Math.max(1, Math.min(50, Math.round(Number(p.need) || 1)));
            const max = Math.max(
              need,
              Math.min(99, Math.round(Number(p.max) || need))
            );
            return { label: String(p.label).slice(0, 60), need, max };
          });
      } catch {
        /* fall through with empty plan */
      }
    }
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    console.error("Signup suggest error:", e);
    return NextResponse.json({ error: "Suggestion failed." }, { status: 500 });
  }
}
