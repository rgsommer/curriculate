import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Classroom Preview — See Curriculate in Action",
  description:
    "Watch a real Curriculate session unfold across eight stations. Interactive auto-cycling preview of student joining, scanning, completing tasks, and rotating between stations.",
  openGraph: {
    title: "Live Classroom Preview — Curriculate",
    description:
      "Watch a real Curriculate session unfold across eight stations: scan, task, rotate, repeat.",
    url: "https://curriculate.net/preview",
    images: [
      { url: "https://curriculate.net/images/og/og-home.png", width: 1200, height: 630 },
    ],
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "https://curriculate.net/preview" },
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
