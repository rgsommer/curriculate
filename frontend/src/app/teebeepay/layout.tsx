// frontend/src/app/teebeepay/layout.tsx
//
// TeebeePay is a standalone product hosted alongside Curriculate but
// presented as its own brand: no Curriculate site header, no footer,
// no Curriculate branding visible to the user. We add a `teebeepay-host`
// class to the body (matching the `capacitor-native` pattern used by
// the mobile app) and globals.css hides .site-header / .site-footer
// when that class is present.
import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.curriculate.net"),
  title: {
    template: "%s · TeebeePay",
    default: "TeebeePay — Payroll for Papua New Guinea SMEs | BSP batch, NASFund, IRC SWT",
  },
  description:
    "Fortnightly payroll for Papua New Guinea SMEs. Enter hours; we deliver pay-stub emails, BSP Batch Manager CSVs, NASFund / NCSL returns, IRC SWT compliance, QuickBooks IIF — plus 2FA, audit log, anomaly alerts and approve-via-email. From PGK 9 per employee per fortnight.",
  keywords: [
    "PNG payroll software", "Papua New Guinea payroll", "payroll PNG",
    "BSP batch manager", "BSP batch CSV", "BSP payroll upload",
    "NASFund return", "NASFund employer contribution", "NCSL contribution",
    "IRC SWT", "salary wages tax PNG", "PNG IRC compliance",
    "Tee Bee Accountants", "TeebeePay",
    "Port Moresby payroll", "Lae payroll", "PNG bureau payroll",
    "multi-company payroll", "fortnightly payroll", "small business payroll PNG",
    "QuickBooks IIF PNG", "pay-stub PNG", "PNG accountants payroll",
  ],
  authors: [{ name: "Tee Bee Accountants Ltd", url: "https://www.curriculate.net/teebee" }],
  creator: "Tee Bee Accountants Ltd",
  publisher: "Tee Bee Accountants Ltd",
  alternates: {
    canonical: "https://www.curriculate.net/teebeepay",
    languages: { "en-PG": "https://www.curriculate.net/teebeepay" },
  },
  openGraph: {
    siteName: "TeebeePay",
    type: "website",
    url: "https://www.curriculate.net/teebeepay",
    title: "TeebeePay — Payroll done for you in Papua New Guinea",
    description:
      "Hours in, pay stubs out — plus BSP batch CSV, NASFund return, IRC SWT compliance, QuickBooks IIF, audit log and 2FA. From PGK 9 per employee per fortnight.",
    locale: "en_PG",
    // OG image is generated dynamically by teebeepay/opengraph-image.tsx
  },
  twitter: {
    card: "summary_large_image",
    title: "TeebeePay — Payroll for Papua New Guinea SMEs",
    description:
      "Fortnightly PNG payroll: pay-stub emails, BSP batch CSV, NASFund return, IRC SWT — bureau-grade, web-based, compliance baked in.",
    // twitter:image also auto-derived from opengraph-image.tsx
  },
  robots: {
    index: true, follow: true,
    googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large", "max-video-preview": -1 },
  },
  category: "Business Software",
};

export default function TeebeePayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Hide Curriculate's site header/footer for all /teebeepay pages by
          tagging <body> before first paint. */}
      <Script id="teebeepay-host" strategy="beforeInteractive">
        {`document.body.classList.add('teebeepay-host');`}
      </Script>
      {children}
    </>
  );
}
