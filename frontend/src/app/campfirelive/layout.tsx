import type { Metadata, Viewport } from "next";
import AppShell from "./AppShell";
import PwaRegister from "./PwaRegister";
import CampfireFeedback from "./CampfireFeedback";

export const metadata: Metadata = {
  title: {
    template: "%s | Campfire",
    default: "Campfire — Group Engagement App",
  },
  description:
    "Campfire is a real-time group engagement app where results stay sealed until everyone responds. Create polls, challenges, games, and accountability check-ins for your family, friends, church, or community.",
  keywords: [
    "campfire app",
    "group engagement",
    "sealed polls",
    "group challenges",
    "family group app",
    "church group activities",
    "community engagement",
    "group games app",
    "accountability app",
    "social engagement platform",
    "group activities",
    "real-time group app",
  ],
  openGraph: {
    title: "Campfire — Group Engagement App",
    description:
      "The group app where nobody sees results until everyone responds. Real-time polls, challenges, games, and accountability — free for 3 months.",
    url: "https://curriculate.net/campfirelive",
    siteName: "Campfire",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "https://curriculate.net/images/og/og-campfire-live.png",
        width: 1200,
        height: 630,
        alt: "Campfire — Group Engagement App",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Campfire — Group Engagement App",
    description:
      "Sealed polls, live challenges, group games, and accountability. The app that brings your group to life.",
    images: ["https://curriculate.net/images/og/og-campfire-live.png"],
  },
  alternates: {
    canonical: "https://curriculate.net/campfirelive",
  },
  robots: {
    index: true,
    follow: true,
  },
  manifest: "/campfire.webmanifest",
  icons: {
    icon: "/campfire-icon-192.png",
    apple: "/campfire-apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Campfire",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#f97316",
};

export default function CampfireLiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "Campfire",
            applicationCategory: "SocialNetworkingApplication",
            operatingSystem: "Web",
            browserRequirements: "Requires JavaScript",
            url: "https://curriculate.net/campfirelive",
            description:
              "Real-time group engagement app with sealed results, 12 activity types, and live presence.",
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "USD",
              description: "Free 3-month trial",
            },
          }),
        }}
      />
      <PwaRegister />
      <AppShell>{children}</AppShell>
      <CampfireFeedback />
    </>
  );
}
