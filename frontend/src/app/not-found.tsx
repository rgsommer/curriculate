import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ padding: 22, maxWidth: 820, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Page not found</h1>
      <p style={{ opacity: 0.8 }}>
        If you scanned a station QR code, start with the demo.
      </p>

      <Link
        href="/demo"
        style={{
          display: "inline-block",
          marginTop: 12,
          padding: "10px 14px",
          borderRadius: 999,
          background: "#0ea5e9",
          color: "#fff",
          fontWeight: 900,
          textDecoration: "none",
        }}
      >
        Go to Demo
      </Link>
    </div>
  );
}
