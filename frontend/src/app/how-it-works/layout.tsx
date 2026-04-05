import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How it Works — Station-Based Learning Made Simple",
  description:
    "See how Curriculate works: plan a time-fit station lesson with AI, run interactive team stations with QR rotation, capture photo evidence, and get automatic teacher and student reports.",
  keywords: [
    "how station rotation works",
    "classroom station setup",
    "station-based learning guide",
    "QR code classroom rotation",
    "team-based learning activities",
    "classroom management tool",
  ],
  openGraph: {
    title: "How it Works — Curriculate",
    description:
      "Plan → Run → Capture → Report. Station-based learning made simple with AI-powered task generation and real-time multiplayer.",
    url: "https://curriculate.net/how-it-works",
    siteName: "Curriculate",
    type: "website",
  },
  alternates: {
    canonical: "https://curriculate.net/how-it-works",
  },
};

export default function HowItWorksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
