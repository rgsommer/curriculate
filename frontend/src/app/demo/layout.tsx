import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try the Demo — Interactive Station Experience",
  description:
    "Try Curriculate's student station experience right in your browser. No sign-up needed — see team-based tasks, photo submissions, and real-time collaboration in action.",
  keywords: [
    "Curriculate demo",
    "try station rotation",
    "classroom demo",
    "interactive learning demo",
    "free classroom tool demo",
  ],
  openGraph: {
    title: "Try the Demo — Curriculate",
    description:
      "Experience station-based learning in your browser. No sign-up required.",
    url: "https://curriculate.net/demo",
    siteName: "Curriculate",
    type: "website",
  },
  alternates: {
    canonical: "https://curriculate.net/demo",
  },
};

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
