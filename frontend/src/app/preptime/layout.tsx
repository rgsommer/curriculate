import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lesson Prep Time Saved — How Curriculate Cuts Hours per Week",
  description:
    "See how Curriculate replaces hours of weekly lesson prep with AI-generated, time-fit task sets. From topic to ready-to-launch in 60 seconds.",
  openGraph: {
    title: "Lesson Prep Time Saved — Curriculate",
    description: "From topic to ready-to-launch in 60 seconds. Reclaim hours of weekly lesson prep.",
    url: "https://curriculate.net/preptime",
    images: [
      { url: "https://curriculate.net/images/og/og-home.png", width: 1200, height: 630 },
    ],
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "https://curriculate.net/preptime" },
};

export default function PrepTimeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
