import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Features — AI-Powered Station-Based Learning",
  description:
    "Explore Curriculate's features: AI lesson planning, time-fit task generation, 20+ interactive task types, real-time multiplayer stations, QR-based rotation, photo evidence capture, and automatic teacher and student reports.",
  keywords: [
    "classroom station rotation",
    "AI lesson planning tool",
    "interactive classroom activities",
    "formative assessment tool",
    "station-based learning software",
    "classroom engagement tools",
    "teacher technology",
    "collaborative learning platform",
  ],
  openGraph: {
    title: "Features — Curriculate Station-Based Learning Platform",
    description:
      "AI plans time-fit lessons, generates 20+ task types, runs real-time multiplayer stations, and produces evidence-rich reports automatically.",
    url: "https://curriculate.net/features",
    siteName: "Curriculate",
    type: "website",
  },
  alternates: {
    canonical: "https://curriculate.net/features",
  },
};

export default function FeaturesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
