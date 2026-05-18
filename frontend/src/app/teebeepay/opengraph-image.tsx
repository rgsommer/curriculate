// Auto-generated Open Graph image for /teebeepay.
// Next.js renders this on demand and injects it into <head> as og:image
// and twitter:image — no static asset needed.
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "TeebeePay — Payroll done for you in Papua New Guinea";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%",
          background: "linear-gradient(135deg, #fffaf0 0%, #fff7e0 60%, #fdebcd 100%)",
          display: "flex", flexDirection: "column", padding: "72px 80px",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          color: "#0f172a",
        }}
      >
        {/* Top row: brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{
            width: 84, height: 84, borderRadius: 18,
            background: "#0f172a", color: "#f4b400",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 44, fontWeight: 800, letterSpacing: -1,
          }}>
            TP
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}>TeebeePay</div>
            <div style={{ fontSize: 22, color: "#64748b", marginTop: 6 }}>
              Papua New Guinea payroll, done for you
            </div>
          </div>
        </div>

        {/* Headline */}
        <div style={{
          marginTop: 48, fontSize: 72, fontWeight: 800, lineHeight: 1.05,
          letterSpacing: -1.5, maxWidth: 1040,
        }}>
          Two tiers.{" "}
          <span style={{ color: "#c08c00" }}>Weeks of FTE saved.</span>
        </div>

        {/* Tier cards */}
        <div style={{ marginTop: 36, display: "flex", gap: 18 }}>
          <div style={{
            flex: 1, padding: "16px 22px", borderRadius: 14,
            background: "#fff", border: "2px solid #0f172a",
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#64748b", letterSpacing: 0.6, textTransform: "uppercase" }}>
              Self-service
            </div>
            <div style={{ fontSize: 38, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>K 9 <span style={{ fontSize: 18, color: "#64748b", fontWeight: 600 }}>/ emp / fortnight</span></div>
            <div style={{ fontSize: 18, color: "#334155", marginTop: 6 }}>You file with BSP &amp; IRC</div>
          </div>
          <div style={{
            flex: 1, padding: "16px 22px", borderRadius: 14,
            background: "#0f172a", border: "2px solid #c08c00",
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f4b400", letterSpacing: 0.6, textTransform: "uppercase" }}>
              Managed bureau
            </div>
            <div style={{ fontSize: 38, fontWeight: 800, color: "#fff", marginTop: 4 }}>K 14 <span style={{ fontSize: 18, color: "#cbd5e1", fontWeight: 600 }}>/ emp / fortnight</span></div>
            <div style={{ fontSize: 18, color: "#e2e8f0", marginTop: 6 }}>CPA files BSP, NASFund, Form S</div>
          </div>
        </div>

        {/* Bottom strip */}
        <div style={{
          marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: 22, color: "#64748b",
        }}>
          <div>www.curriculate.net/teebeepay</div>
          <div>~6 weeks of FTE saved / year</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
