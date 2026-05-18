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
          marginTop: 64, fontSize: 78, fontWeight: 800, lineHeight: 1.05,
          letterSpacing: -1.5, maxWidth: 1040,
        }}>
          Hours in. Pay stubs out.
          <br />
          <span style={{ color: "#c08c00" }}>Compliance baked in.</span>
        </div>

        {/* Feature chips */}
        <div style={{
          marginTop: 56, display: "flex", flexWrap: "wrap", gap: 14,
        }}>
          {[
            "BSP batch CSV",
            "NASFund / NCSL",
            "IRC SWT 2026",
            "QuickBooks IIF",
            "2FA + audit log",
            "Approve via email",
          ].map((f) => (
            <div key={f} style={{
              padding: "12px 22px", borderRadius: 999,
              background: "#0f172a", color: "#fff",
              fontSize: 24, fontWeight: 600,
              display: "flex", alignItems: "center",
            }}>
              {f}
            </div>
          ))}
        </div>

        {/* Bottom strip */}
        <div style={{
          marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: 22, color: "#64748b",
        }}>
          <div>www.curriculate.net/teebeepay</div>
          <div>From PGK 9 / employee / fortnight</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
