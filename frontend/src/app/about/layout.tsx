import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — Built by a Teacher, for Teachers",
  description:
    "Curriculate was built by a classroom teacher who wanted station-based learning without the chaos. Learn about the mission, the team, and why active learning matters.",
  keywords: [
    "about Curriculate",
    "education startup",
    "teacher-built classroom tool",
    "active learning company",
  ],
  openGraph: {
    title: "About — Curriculate",
    description:
      "Built by a teacher, for teachers. Station-based learning without the chaos.",
    url: "https://curriculate.net/about",
    siteName: "Curriculate",
    type: "website",
  },
  alternates: {
    canonical: "https://curriculate.net/about",
  },
};

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
