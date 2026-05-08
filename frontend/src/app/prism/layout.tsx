import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prism is now Pulse Grading",
  description:
    "Prism has been rebranded to Pulse Grading. AI grading for teachers — photos, paste, batch PDF, audio, and video — at curriculate.net/grading.",
  // /prism is a legacy redirect; canonicalize ranking signals to /pulse and don't index.
  alternates: { canonical: "https://curriculate.net/pulse" },
  robots: { index: false, follow: true },
};

export default function PrismLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
