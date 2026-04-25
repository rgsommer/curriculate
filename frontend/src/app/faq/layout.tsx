import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ — Frequently Asked Questions",
  description:
    "Answers to common questions about Curriculate: classroom scavenger hunts, screen time, device use, handwriting bonus, Pulse, student privacy, collaboration, and getting started.",
  keywords: [
    "Curriculate FAQ",
    "classroom scavenger hunt questions",
    "Pulse questions",
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
      "Common questions about classroom scavenger hunts, screen time, Pulse, pricing, and getting started.",
    url: "https://curriculate.net/faq",
    siteName: "Curriculate",
    type: "website",
    images: [
      {
        url: "https://curriculate.net/images/og/og-faq.png",
        width: 1200,
        height: 630,
        alt: "Curriculate FAQ",
      },
    ],
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
