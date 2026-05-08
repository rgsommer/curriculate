import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Free Trial — Try Curriculate Free for 14 Days",
  description:
    "Start a free 14-day trial of Curriculate. Generate AI lesson task sets, run live classroom scavenger hunts, and get gradebook-ready reports — no credit card to start.",
  openGraph: {
    title: "Free Trial — Curriculate AI Classroom Scavenger Hunts",
    description:
      "14-day free trial. AI lesson planning, live station-based gameplay, and gradebook-ready reports.",
    url: "https://curriculate.net/freetrial",
    images: [
      { url: "https://curriculate.net/images/og/og-home.png", width: 1200, height: 630 },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Trial — Curriculate",
    description: "14-day free trial. AI station-based learning + gradebook-ready reports.",
  },
  alternates: { canonical: "https://curriculate.net/freetrial" },
};

export default function FreeTrialLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
