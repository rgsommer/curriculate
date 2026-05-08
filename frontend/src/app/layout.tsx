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
  metadataBase: new URL("https://curriculate.net"),
  title: {
    template: "%s | Curriculate.net",
    default: "Curriculate.net – AI Classroom Scavenger Hunts + AI Grading",
  },
  description:
    "Curriculate is a two-product platform for K-12 teachers: AI-powered classroom scavenger hunts (live station-based learning) plus Pulse Grading (AI grading at curriculate.net/grading) — with native Edsby roster import and gradebook-ready reports.",
  keywords: [
    "education",
    "classroom scavenger hunt",
    "scavenger hunt learning",
    "classroom activities",
    "AI lesson planning",
    "AI grading",
    "AI grader for teachers",
    "Pulse Grading",
    "Edsby gradebook export",
    "Edsby class roster",
    "formative assessment",
    "interactive learning",
    "teacher tools",
    "team-based learning",
    "CurricQR code classroom",
    "student reports",
    "parent reports",
    "movement in classroom",
    "birthday party games for kids",
    "corporate team building games",
    "role play classroom",
    "classroom gamification",
    "subject-specific activities",
    "Kahoot alternative",
    "Blooket alternative",
    "Quizlet alternative",
    "screen-free classroom learning",
    "handwriting bonus classroom",
    "reduce screen time school",
  ],
  authors: [{ name: "Curriculate" }],
  creator: "Curriculate",
  publisher: "Curriculate",
  alternates: {
    canonical: "https://curriculate.net",
  },
  openGraph: {
    siteName: "Curriculate",
    type: "website",
    url: "https://curriculate.net",
    locale: "en_CA",
    images: [
      {
        url: "https://curriculate.net/images/og/og-home.png",
        width: 1200,
        height: 630,
        alt: "Curriculate — AI Classroom Scavenger Hunts + AI Grading",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@CurriculateNet",
    creator: "@CurriculateNet",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
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
        {/* Detect Capacitor native app shell and hide website chrome */}
        <Script id="capacitor-detect" strategy="afterInteractive">
          {`
            (function() {
              try {
                var isApp = (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
                  || window.location.search.includes('app=1')
                  || sessionStorage.getItem('capacitor-native') === '1';
                if (isApp) {
                  document.body.classList.add('capacitor-native');
                  sessionStorage.setItem('capacitor-native', '1');
                }
              } catch(e) {}
            })();
          `}
        </Script>
        {/* Structured data: WebSite, Organization, and SoftwareApplication.
            These help search engines build the knowledge panel and the
            sitelinks search box, and they qualify the products for rich
            results in education-related searches. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Curriculate",
              url: "https://curriculate.net",
              description:
                "AI-powered classroom scavenger hunt platform plus Pulse Grading — time-fit lesson planning, interactive team stations, AI grading, and gradebook-ready reporting with native Edsby integration.",
              potentialAction: {
                "@type": "SearchAction",
                target: "https://curriculate.net/search?q={search_term_string}",
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Curriculate",
              url: "https://curriculate.net",
              logo: "https://curriculate.net/images/og/og-home.png",
              description:
                "Curriculate builds AI tools for K-12 teachers — live classroom scavenger hunts and AI grading.",
              sameAs: [
                "https://twitter.com/CurriculateNet",
              ],
              contactPoint: [
                {
                  "@type": "ContactPoint",
                  contactType: "customer support",
                  email: "support@curriculate.net",
                  url: "https://curriculate.net/contact",
                  availableLanguage: ["English"],
                },
              ],
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "Curriculate",
              applicationCategory: "EducationalApplication",
              operatingSystem: "Web, Android",
              url: "https://curriculate.net",
              description:
                "AI-powered classroom scavenger hunts plus AI grading. Edsby roster import, gradebook-ready CSV export, per-student improvement tracking.",
              offers: [
                {
                  "@type": "Offer",
                  name: "Free",
                  price: "0",
                  priceCurrency: "USD",
                },
                {
                  "@type": "Offer",
                  name: "Plus",
                  price: "6.99",
                  priceCurrency: "USD",
                  description: "Class linking, gradebook integration, student-level reports.",
                },
                {
                  "@type": "Offer",
                  name: "Pro",
                  price: "12.99",
                  priceCurrency: "USD",
                  description: "Per-student improvement reports + advanced analytics.",
                },
              ],
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
