import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ — Frequently Asked Questions",
  description:
    "Answers to common questions about Curriculate: how station rotation works, pricing, AI grading, student privacy, device requirements, and getting started.",
  keywords: [
    "Curriculate FAQ",
    "station rotation questions",
    "AI grading questions",
    "classroom tool FAQ",
    "teacher tool help",
  ],
  openGraph: {
    title: "FAQ — Curriculate",
    description:
      "Common questions about station-based learning, AI grading, pricing, and getting started.",
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
