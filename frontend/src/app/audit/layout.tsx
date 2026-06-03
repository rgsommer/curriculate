// /audit — TeeBee Accountants audit-readiness platform.
// Standalone visual shell, similar to /teebeepay.
import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.curriculate.net"),
  title: {
    template: "%s · TeeBee Audit",
    default: "TeeBee Audit — CPA-led audit-readiness platform for Papua New Guinea",
  },
  description:
    "software-assisted audit-readiness platform from TeeBee Accountants. Upload your trial balance, GL and supporting files; our software runs reconciliations and anomaly checks; a CPA reviews and issues the final report. PNG IRC-compliant, IFRS-aligned, audit-trail complete.",
  keywords: [
    "PNG audit", "Papua New Guinea audit", "statutory audit PNG",
    "CPA audit PNG", "TeeBee Accountants audit", "TBA audit",
    "audit readiness PNG", "IFRS audit PNG", "IRC audit",
    "Port Moresby audit firm", "external audit Papua New Guinea",
    "software-assisted audit", "audit software PNG", "landowner company audit",
  ],
  authors: [{ name: "TeeBee Accountants Ltd", url: "https://www.curriculate.net/teebee" }],
  creator: "TeeBee Accountants Ltd",
  publisher: "TeeBee Accountants Ltd",
  alternates: { canonical: "https://www.curriculate.net/audit" },
  openGraph: {
    siteName: "TeeBee Audit",
    type: "website",
    url: "https://www.curriculate.net/audit",
    title: "TeeBee Audit — CPA-led audit platform for PNG",
    description:
      "software-assisted audit workflow: upload files, software runs the checks, a registered CPA signs the opinion.",
    locale: "en_PG",
  },
  twitter: {
    card: "summary_large_image",
    title: "TeeBee Audit — CPA-led audit platform for PNG",
    description: "software-assisted audit workflow with CPA-signed opinion.",
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
