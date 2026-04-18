import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ — Frequently Asked Questions",
  description:
    "Answers to common questions about Curriculate: station rotation, screen time, device use, handwriting bonus, AI grading, student privacy, collaboration, and getting started.",
  keywords: [
    "Curriculate FAQ",
    "station rotation questions",
    "AI grading questions",
    "classroom tool FAQ",
    "teacher tool help",
    "reduce screen time classroom",
    "screen-free learning",
    "handwriting in classroom technology",
    "off-screen learning activities",
  ],
  openGraph: {
    title: "FAQ — Curriculate",
    description:
      "Common questions about station-based learning, screen time, AI grading, pricing, and getting started.",
    url: "https://curriculate.net/faq",
    siteName: "Curriculate",
    type: "website",
  },
  alternates: {
    canonical: "https://curriculate.net/faq",
  },
};

export default function FAQLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
