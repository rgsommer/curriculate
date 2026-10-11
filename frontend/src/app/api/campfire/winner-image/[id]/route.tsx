import { ImageResponse } from "next/og";
import { resolveTitle } from "@/lib/campfire/types";

// The winner's celebration card, as a picture — the top of the contest winner emails.
// Shows the winning photo, the winner's name, the contest and the vote count. Only
// renders once a winner is decided; the id is an unguessable UUID.
export const runtime = "edge";

const W = 1000;
const H = 820;
const FONT_BASE = "https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin";

async function loadFonts() {
  try {
    const [bold, medium] = await Promise.all(
      [800, 500].map((w) =>
        fetch(`${FONT_BASE}-${w}-normal.woff`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      )
    );
    return [
      { name: "Inter", data: bold, weight: 800 as const, style: "normal" as const },
      { name: "Inter", data: medium, weight: 500 as const, style: "normal" as const },
    ];
  } catch {
    return undefined;
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = (params.id || "").toLowerCase();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!/^[0-9a-f-]{36}$/.test(id) || !url || !key) return new Response("Not found", { status: 404 });
  const rest = async (path: string) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" });
    return r.ok ? ((await r.json()) as Array<Record<string, unknown>>) : [];
  };

  const [e] = await rest(`engagements?id=eq.${id}&select=group_id,title,birth_year,deadline,config,gift_currency`);
  const cfg = (e?.config as { raffle?: { winnerUserId?: string }; tournament?: unknown } | null) ?? null;
  const winnerUid = cfg?.raffle?.winnerUserId;
  if (!e || !winnerUid || !/^[0-9a-f-]{36}$/.test(winnerUid)) return new Response("Not found", { status: 404 });

  const [[entry], [gm], [profile], votes, contribs] = await Promise.all([
    rest(`responses?engagement_id=eq.${id}&user_id=eq.${winnerUid}&select=id,content`),
    rest(`group_members?group_id=eq.${e.group_id}&user_id=eq.${winnerUid}&select=display_name`),
    rest(`profiles?id=eq.${winnerUid}&select=display_name`),
    rest(`campfire_challenge_votes?engagement_id=eq.${id}&select=response_id,voter_user_id`),
    rest(`campfire_gift_contributions?engagement_id=eq.${id}&status=eq.paid&select=amount_cents`),
  ]);
  const giftCents = contribs.reduce((a, c) => a + (Number(c.amount_cents) || 0), 0);
  const cur = String(e.gift_currency || "usd").toUpperCase();
  const gift =
    giftCents > 0
      ? `$${(giftCents / 100).toFixed(giftCents % 100 ? 2 : 0)}${cur === "USD" ? "" : ` ${cur}`} gift card`
      : null;
  const name = (gm?.display_name as string) || (profile?.display_name as string) || "Our winner";
  const content = (entry?.content as { media_url?: string; caption?: string; subject?: string } | null) ?? null;
  const subject = content?.subject?.trim() || null; // who's pictured, when not the entrant
  // Satori reliably decodes PNG/JPEG only.
  const photo = content?.media_url && /\.(png|jpe?g)(\?|$)/i.test(content.media_url) ? content.media_url : null;
  const caption = content?.caption?.trim() || null;
  const n = entry
    ? votes.filter((v) => v.response_id === entry.id && v.voter_user_id !== winnerUid).length
    : 0;
  const title = resolveTitle(e.title as string, e.birth_year as number | null, e.deadline as string | null);
  const fonts = await loadFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 45%, #fdba74 100%)",
          fontFamily: fonts ? "Inter" : "sans-serif",
          position: "relative",
        }}
      >
        {/* confetti */}
        {["🎉", "✨", "🎊", "⭐", "🎉", "✨"].map((c, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              fontSize: 44,
              display: "flex",
              left: [40, 880, 70, 900, 470, 160][i],
              top: [40, 60, 620, 600, 18, 330][i],
            }}
          >
            {c}
          </div>
        ))}
        <div
          style={{
            width: 780,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            background: "#ffffff",
            borderRadius: 32,
            border: "3px solid #f59e0b",
            boxShadow: "0 18px 50px rgba(180, 83, 9, 0.25)",
            padding: "30px 44px 34px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 800, color: "#b45309", letterSpacing: 4 }}>
            🏆 WINNER 🏆
          </div>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt=""
              width={692}
              height={390}
              style={{ width: 692, height: 390, objectFit: "contain", borderRadius: 18, marginTop: 16, background: "#fffbeb" }}
            />
          ) : (
            <div style={{ fontSize: 150, marginTop: 10, display: "flex" }}>🥇</div>
          )}
          <div style={{ marginTop: 18, fontSize: 52, fontWeight: 800, color: "#0f172a", display: "flex", letterSpacing: -1 }}>
            {subject ?? name}
          </div>
          {subject && (
            <div style={{ marginTop: 2, fontSize: 22, fontWeight: 500, color: "#64748b", display: "flex" }}>
              entered by {name}
            </div>
          )}
          {caption && (
            <div style={{ marginTop: 4, fontSize: 24, fontWeight: 500, color: "#475569", display: "flex", fontStyle: "italic" }}>
              “{caption.length > 60 ? caption.slice(0, 57) + "…" : caption}”
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 24, fontWeight: 500, color: "#92400e", display: "flex", textAlign: "center" }}>
            {title.length > 56 ? title.slice(0, 53) + "…" : title}
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
          {!cfg?.tournament && n > 0 && (
            <div
              style={{
                display: "flex",
                fontSize: 24,
                fontWeight: 800,
                color: "#ffffff",
                background: "linear-gradient(to right, #f59e0b, #f97316)",
                borderRadius: 9999,
                padding: "10px 26px",
              }}
            >
              🗳️ {n} {n === 1 ? "vote" : "votes"} from the group
            </div>
          )}
          {gift && (
            <div
              style={{
                display: "flex",
                fontSize: 24,
                fontWeight: 800,
                color: "#ffffff",
                background: "linear-gradient(to right, #10b981, #059669)",
                borderRadius: 9999,
                padding: "10px 26px",
              }}
            >
              🎁 + {gift}
            </div>
          )}
          </div>
        </div>
        <div style={{ position: "absolute", right: 30, bottom: 20, fontSize: 22, fontWeight: 800, color: "#9a3412", display: "flex" }}>
          🔥 Campfire
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      emoji: "twemoji",
      fonts,
      headers: { "Cache-Control": "public, max-age=600, s-maxage=3600" },
    }
  );
}
