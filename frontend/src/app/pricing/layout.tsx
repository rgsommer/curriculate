import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Free Plan & Premium Options",
  description:
    "Curriculate pricing for teachers and schools. Free plan includes Prism and basic stations. Premium plans add unlimited task sets, advanced reports, and school-wide features.",
  keywords: [
    "Curriculate pricing",
    "teacher tool pricing",
    "classroom software cost",
    "free teacher tools",
    "school software pricing",
    "education technology pricing",
  ],
  openGraph: {
    title: "Pricing — Curriculate",
    description:
      "Free plan available. Premium plans for teachers and schools with unlimited task sets, advanced reports, and Prism.",
    url: "https://curriculate.net/pricing",
    siteName: "Curriculate",
    type: "website",
    images: [
      {
        url: "https://curriculate.net/images/og/og-pricing.png",
        width: 1200,
        height: 630,
        alt: "Curriculate Pricing",
      },
    ],
  },
  alternates: {
    canonical: "https://curriculate.net/pricing",
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
