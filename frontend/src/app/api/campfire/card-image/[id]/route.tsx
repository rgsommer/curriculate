import { ImageResponse } from "next/og";
import { engagementIcon, engagementLabel, resolveTitle } from "@/lib/campfire/types";

// The card itself, as a picture — embedded at the top of card invite emails (and
// usable as a link preview). Shows the card front: emoji (or the host's cover
// photo), the title, the occasion and when it opens. Only the card's own public
// bits — the id is an unguessable UUID, and nothing here isn't already in the invite.
export const runtime = "edge";

const W = 1000;
const H = 700;

// Inter (bold + medium) so the title reads like a card, not a form. Satori takes
// woff, not woff2. If the CDN is unreachable, render with the default font.
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

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = (params.id || "").toLowerCase();
  // ?for=recipient → "Open your card" (the reveal email to the guest of honour);
  // ?for=delivered → signers' "it was delivered" email; default → invite to sign.
  // n = how many notes are inside (display only).
  const qs = new URL(req.url).searchParams;
  const mode = qs.get("for");
  const n = Math.max(0, Math.min(9999, parseInt(qs.get("n") || "0", 10) || 0));
  const notes = `${n} ${n === 1 ? "note" : "notes"} inside`;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!/^[0-9a-f-]{36}$/.test(id) || !url || !key) return new Response("Not found", { status: 404 });

  const res = await fetch(
    `${url}/rest/v1/engagements?id=eq.${id}&select=type,title,birth_year,deadline,config,cover_image_url`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
  );
  const rows = res.ok ? ((await res.json()) as Array<Record<string, unknown>>) : [];
  const e = rows[0];
  if (!e || e.type !== "birthday") return new Response("Not found", { status: 404 });

  const config = (e.config as { occasion?: string } | null) ?? null;
  const title = resolveTitle(e.title as string, e.birth_year as number | null, e.deadline as string | null);
  const label = engagementLabel({ type: "birthday", config });
  const emoji = engagementIcon({ type: "birthday", config });
  const deadline = e.deadline ? new Date(e.deadline as string) : null;
  const opens =
    deadline && deadline.getTime() > Date.now()
      ? `opens ${deadline.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          ...(deadline.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
          timeZone: "America/Toronto",
        })}`
      : null;
  // Satori reliably decodes PNG/JPEG only — anything else falls back to the emoji.
  const cover =
    typeof e.cover_image_url === "string" && /\.(png|jpe?g)(\?|$)/i.test(e.cover_image_url)
      ? (e.cover_image_url as string)
      : null;
  const titleSize = title.length > 48 ? 40 : title.length > 30 ? 48 : 56;
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
          background: "linear-gradient(135deg, #fff7ed 0%, #ffe4e6 100%)",
          fontFamily: fonts ? "Inter" : "sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            width: 800,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#ffffff",
            borderRadius: 32,
            border: "2px solid #fed7aa",
            boxShadow: "0 18px 50px rgba(244, 63, 94, 0.18)",
            padding: "36px 48px",
            transform: "rotate(-1.5deg)",
            overflow: "hidden",
          }}
        >
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt=""
              width={704}
              height={260}
              // contain, not cover: card covers are often lettering that cropping cuts off
              style={{ width: 704, height: 260, objectFit: "contain", borderRadius: 18, marginBottom: 20 }}
            />
          ) : (
            <div style={{ fontSize: 130, lineHeight: 1, marginBottom: 18, display: "flex" }}>{emoji}</div>
          )}
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "#e11d48",
              marginBottom: 10,
              display: "flex",
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: titleSize,
              fontWeight: 800,
              color: "#0f172a",
              textAlign: "center",
              lineHeight: 1.15,
              letterSpacing: -1,
              display: "flex",
              justifyContent: "center",
              maxWidth: 704,
            }}
          >
            {title}
          </div>
          <div
            style={{
              marginTop: 26,
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 26,
              fontWeight: 800,
              color: "#ffffff",
              background: "linear-gradient(to right, #f97316, #f43f5e)",
              borderRadius: 9999,
              padding: "12px 30px",
            }}
          >
            {mode === "recipient"
              ? `💌 Open your card${n ? ` · ${notes}` : ""}`
              : mode === "delivered"
              ? `💌 Delivered${n ? ` · ${notes}` : ""}`
              : `✍️ Sign the card${opens ? ` · ${opens}` : ""}`}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: 34,
            bottom: 24,
            fontSize: 22,
            fontWeight: 700,
            color: "#9a3412",
            display: "flex",
          }}
        >
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
