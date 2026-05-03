import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Features — AI-Powered Station-Based Learning",
  description:
    "Explore Curriculate's features: AI lesson planning, time-fit task generation, 65+ interactive task types including fill-in-the-blank, live AI interviews, and peer editing with teacher-style markup. Real-time multiplayer stations, CurricQR-based rotation, photo evidence, and automatic reports.",
  keywords: [
    "classroom station rotation",
    "AI lesson planning tool",
    "interactive classroom activities",
    "formative assessment tool",
    "station-based learning software",
    "classroom engagement tools",
    "teacher technology",
    "collaborative learning platform",
    "handwriting bonus classroom",
    "trivia classroom game",
    "spinner reward classroom",
    "off-screen learning technology",
    "screen-free classroom activities",
  ],
  openGraph: {
    title: "Features — Curriculate Station-Based Learning Platform",
    description:
      "AI plans time-fit lessons, generates 65+ task types including cloze, AI interviews, and peer editing. Real-time multiplayer stations and evidence-rich reports.",
    url: "https://curriculate.net/features",
    siteName: "Curriculate",
    type: "website",
    images: [
      {
        url: "https://curriculate.net/images/og/og-features.png",
        width: 1200,
        height: 630,
        alt: "Curriculate Features",
      },
    ],
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
