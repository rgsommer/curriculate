// frontend/src/app/teebee/layout.tsx
//
// Tee Bee Accountants standalone shell — no Curriculate header/footer.
// Same trick as /teebeepay: a class on <body> hides .site-header/.site-footer
// via globals.css.
import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: {
    template: "%s · Tee Bee Accountants Ltd",
    default: "Tee Bee Accountants Ltd — CPA-certified accounting, audit & advisory in Papua New Guinea",
  },
  description:
    "Tee Bee Accountants Ltd (TBA) is a CPA-certified PNG accounting and audit firm. Audit & assurance, taxation, accounting, business advisory, statutory compliance, financial consulting. Registered tax agents with the PNG IRC.",
  keywords: [
    "Tee Bee Accountants",
    "TBA Port Moresby",
    "CPA Papua New Guinea",
    "PNG audit firm",
    "PNG tax agent",
    "IRC tax compliance PNG",
    "IFRS audit PNG",
    "accounting firm Port Moresby",
    "Statutory compliance PNG",
    "Business advisory PNG",
    "Payroll bureau Papua New Guinea",
  ],
  alternates: { canonical: "https://www.curriculate.net/teebee" },
  openGraph: {
    siteName: "Tee Bee Accountants Ltd",
    type: "website",
    url: "https://www.curriculate.net/teebee",
    title: "Tee Bee Accountants Ltd — CPA-certified accounting & audit in PNG",
    description:
      "10+ years, 500+ clients. CPA-certified. Registered with PNG Accountants Registration Board. Registered tax agents with the IRC.",
  },
  robots: { index: true, follow: true },
};

export default function TeebeeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="teebee-host" strategy="beforeInteractive">
        {`document.body.classList.add('teebopay-host');`}
      </Script>
      {children}
    </>
  );
}
