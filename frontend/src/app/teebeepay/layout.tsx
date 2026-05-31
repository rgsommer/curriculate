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
    default: "TeebeePay — Papua New Guinea Payroll, Two Tiers | BSP, NASFund, IRC SWT, Form S",
  },
  description:
    "Fortnightly payroll for Papua New Guinea SMEs. Two tiers: Self-service from PGK 9 / employee, or Managed Bureau from PGK 14 / employee where a CPA files BSP, NASFund, IRC SWT and Form S for you. Save ~6 weeks of FTE time per year vs manual processing. Pay-stub emails, supervisor timesheet flow, 2FA, audit log, post-approval bank-funding email with PDF attachment.",
  keywords: [
    "PNG payroll software", "Papua New Guinea payroll", "payroll PNG",
    "BSP batch manager", "BSP batch CSV", "BSP payroll upload",
    "NASFund return", "NASFund employer contribution", "NCSL contribution",
    "IRC SWT", "salary wages tax PNG", "PNG IRC compliance",
    "IRC Form S", "PNG Form S annual reconciliation",
    "managed payroll bureau PNG", "outsourced payroll PNG",
    "TeeBee Accountants", "TeebeePay",
    "Port Moresby payroll", "Lae payroll", "PNG bureau payroll",
    "multi-company payroll", "fortnightly payroll", "small business payroll PNG",
    "QuickBooks IIF PNG", "pay-stub PNG", "PNG accountants payroll",
    "supervisor timesheet PNG", "tap clock-in clock-out PNG",
    "CPA payroll filing PNG", "PNG Employment Act leave compliance",
  ],
  authors: [{ name: "TeeBee Accountants Ltd", url: "https://www.curriculate.net/teebee" }],
  creator: "TeeBee Accountants Ltd",
  publisher: "TeeBee Accountants Ltd",
  alternates: {
    canonical: "https://www.curriculate.net/teebeepay",
    languages: { "en-PG": "https://www.curriculate.net/teebeepay" },
  },
  openGraph: {
    siteName: "TeebeePay",
    type: "website",
    url: "https://www.curriculate.net/teebeepay",
    title: "TeebeePay — Papua New Guinea Payroll, Two Tiers",
    description:
      "Self-service from PGK 9 / employee / fortnight or CPA-managed bureau from PGK 14. Save ~6 weeks of FTE time per year. BSP, NASFund, IRC SWT, Form S — all handled.",
    locale: "en_PG",
    // OG image is generated dynamically by teebeepay/opengraph-image.tsx
  },
  twitter: {
    card: "summary_large_image",
    title: "TeebeePay — PNG payroll, two tiers, weeks of time saved",
    description:
      "Self-service from K9/employee or CPA-managed from K14. BSP, NASFund, IRC SWT, Form S. Save ~6 weeks of FTE/year vs manual.",
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
