// /audit — Tee Bee Accountants audit-readiness platform.
// Standalone visual shell, similar to /teebeepay.
import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.curriculate.net"),
  title: {
    template: "%s · Tee Bee Audit",
    default: "Tee Bee Audit — CPA-led audit-readiness platform for Papua New Guinea",
  },
  description:
    "AI-assisted audit-readiness platform from Tee Bee Accountants. Upload your trial balance, GL and supporting files; our software runs reconciliations and anomaly checks; a CPA reviews and issues the final report. PNG IRC-compliant, IFRS-aligned, audit-trail complete.",
  keywords: [
    "PNG audit", "Papua New Guinea audit", "statutory audit PNG",
    "CPA audit PNG", "Tee Bee Accountants audit", "TBA audit",
    "audit readiness PNG", "IFRS audit PNG", "IRC audit",
    "Port Moresby audit firm", "external audit Papua New Guinea",
    "AI assisted audit", "audit software PNG", "landowner company audit",
  ],
  authors: [{ name: "Tee Bee Accountants Ltd", url: "https://www.curriculate.net/teebee" }],
  creator: "Tee Bee Accountants Ltd",
  publisher: "Tee Bee Accountants Ltd",
  alternates: { canonical: "https://www.curriculate.net/audit" },
  openGraph: {
    siteName: "Tee Bee Audit",
    type: "website",
    url: "https://www.curriculate.net/audit",
    title: "Tee Bee Audit — CPA-led audit platform for PNG",
    description:
      "AI-assisted audit workflow: upload files, software runs the checks, a registered CPA signs the opinion.",
    locale: "en_PG",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tee Bee Audit — CPA-led audit platform for PNG",
    description: "AI-assisted audit workflow with CPA-signed opinion.",
  },
  robots: { index: true, follow: true },
  category: "Business Software",
};

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="audit-host" strategy="beforeInteractive">
        {`document.body.classList.add('teebeepay-host');`}
      </Script>
      {children}
    </>
  );
}
