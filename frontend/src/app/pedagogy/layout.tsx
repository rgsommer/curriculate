import type { Metadata } from "next";

export const metadata: Metadata = {
  title:
    "Pedagogy & Learning Science — Bloom's Taxonomy Coverage | Curriculate",
  description:
    "See how Curriculate's 65+ task types map to Bloom's Taxonomy, Webb's Depth of Knowledge, SOLO Taxonomy, and VARK modalities. 38% of tasks target higher-order thinking (Evaluate + Create) — far beyond quiz-only tools. Includes teach-back explanations for deeper understanding.",
  keywords: [
    "Bloom's taxonomy classroom tool",
    "higher order thinking activities",
    "Webb's depth of knowledge",
    "SOLO taxonomy activities",
    "Bloom's taxonomy task types",
    "classroom learning science",
    "active learning framework",
    "station rotation pedagogy",
    "cognitive levels classroom",
    "Curriculate pedagogy",
    "higher order thinking classroom tool",
    "Bloom's taxonomy edtech",
  ],
  openGraph: {
    title: "Pedagogy & Learning Science — Curriculate",
    description:
      "65+ task types mapped to Bloom's Taxonomy. 38% higher-order thinking. See the cognitive coverage no quiz tool can match.",
    url: "https://curriculate.net/pedagogy",
    siteName: "Curriculate",
    type: "website",
    images: [
      {
        url: "https://curriculate.net/images/og/og-pedagogy.png",
        width: 1200,
        height: 630,
        alt: "Curriculate — Bloom's Taxonomy Coverage",
      },
    ],
  },
  alternates: {
    canonical: "https://curriculate.net/pedagogy",
  },
};

export default function PedagogyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
