export const metadata = {
  title: "Free Trial | Curriculate",
  description:
    "Try Curriculate free — interactive classroom learning powered by AI.",
};

export default function FreeTrialPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "48px 16px",
        background: "radial-gradient(circle at top, #0f172a, #020617)",
        color: "#e5e7eb",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h1
          style={{
            fontSize: "2.2rem",
            fontWeight: 900,
            marginBottom: 12,
            color: "#ffffff",
          }}
        >
          Start Your Free Trial
        </h1>

        <p style={{ opacity: 0.9, fontSize: "1.05rem", marginBottom: 28 }}>
          Experience <strong>Curriculate</strong> exactly as your students will —
          interactive tasks, live teamwork, and zero prep headaches.
        </p>

        <ul
          style={{
            lineHeight: 1.6,
            marginBottom: 32,
            paddingLeft: 18,
          }}
        >
          <li>✔ Live classroom task engine</li>
          <li>✔ AI-generated & physical learning tasks</li>
          <li>✔ Works instantly — no install</li>
          <li>✔ Cancel anytime</li>
        </ul>

        <a
          href="/signup"
          style={{
            display: "inline-block",
            padding: "14px 22px",
            borderRadius: 999,
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.85), rgba(14,165,233,0.85))",
            color: "#fff",
            fontWeight: 900,
            textDecoration: "none",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          }}
        >
          Start Free Trial →
        </a>
      </div>
    </main>
  );
}
