// frontend/src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    template: "%s | Curriculate.net",
    default: "Curriculate.net – AI-Powered Station-Based Learning",
  },
  description:
    "AI-powered lesson planning and station-based learning. Curriculate plans time-fit task sets, then generates interactive stations with movement, collaboration, and evidence-rich reporting.",
  keywords: [
    "education",
    "station rotation",
    "classroom activities",
    "AI lesson planning",
    "formative assessment",
    "interactive learning",
    "teacher tools",
    "team-based learning",
    "QR code classroom",
    "AI grading",
    "student reports",
    "movement in classroom",
    "birthday party games for kids",
    "corporate team building games",
    "role play classroom",
    "formative assessment tools",
    "classroom gamification",
    "subject-specific activities",
    "Kahoot alternative",
    "Blooket alternative",
    "Quizlet alternative",
    "screen-free classroom learning",
    "off-screen learning technology",
    "handwriting bonus classroom",
    "reduce screen time school",
  ],
  openGraph: {
    siteName: "Curriculate",
    type: "website",
    url: "https://curriculate.net",
    images: [
      {
        url: "https://curriculate.net/images/og/og-home.png",
        width: 1200,
        height: 630,
        alt: "Curriculate — AI-Powered Station-Based Learning",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@CurriculateNet",
    creator: "@CurriculateNet",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Google tag (gtag.js) */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-PV7DD848BT"
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){window.dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-PV7DD848BT');
          `}
        </Script>
      </head>

      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Curriculate",
              url: "https://curriculate.net",
              description:
                "AI-powered station-based learning platform with time-fit lesson planning, interactive team stations, and evidence-rich reporting.",
              potentialAction: {
                "@type": "SearchAction",
                target: "https://curriculate.net/search?q={search_term_string}",
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
        <SiteHeader />
        <div className="min-h-[70vh]">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
