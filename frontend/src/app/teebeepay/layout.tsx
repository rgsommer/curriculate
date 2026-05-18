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
  title: {
    template: "%s · TeebeePay",
    default: "TeebeePay — Payroll done for you in Papua New Guinea",
  },
  description:
    "Fortnightly payroll for PNG SMEs. Hours in, pay stubs out — plus BSP batch, NASFund return, and IRC summary. Compliance baked in.",
  alternates: { canonical: "https://www.curriculate.net/teebeepay" },
  openGraph: {
    siteName: "TeebeePay",
    type: "website",
    url: "https://www.curriculate.net/teebeepay",
    title: "TeebeePay — Payroll done for you in Papua New Guinea",
    description:
      "Fortnightly payroll for PNG SMEs. Hours in, pay stubs out — plus BSP batch, NASFund return, and IRC summary.",
  },
  robots: { index: true, follow: true },
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
