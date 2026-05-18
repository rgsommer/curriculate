// frontend/src/app/teebee/blog/layout.tsx — shared blog shell.
import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: { template: "%s · Tee Bee Accountants Blog", default: "TBA Blog · PNG accounting & payroll" },
  description: "Tee Bee Accountants Ltd blog — practical guides to PNG IRC compliance, NASFund filings, payroll, and SME finance.",
  alternates: { canonical: "https://www.curriculate.net/teebee/blog" },
  robots: { index: true, follow: true },
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="teebee-host-blog" strategy="beforeInteractive">
        {`document.body.classList.add('teebopay-host');`}
      </Script>
      {children}
    </>
  );
}
