import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Referrals & Affiliate Program",
  description:
    "Refer Curriculate to other teachers, schools, or districts and earn commission. Apply for the affiliate program, share your link, and track conversions.",
  openGraph: {
    title: "Curriculate Referrals — Earn for Teachers You Refer",
    description: "Refer Curriculate, earn commission, track conversions in your dashboard.",
    url: "https://curriculate.net/referrals",
    images: [
      { url: "https://curriculate.net/images/og/og-home.png", width: 1200, height: 630 },
    ],
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "https://curriculate.net/referrals" },
};

export default function ReferralsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
