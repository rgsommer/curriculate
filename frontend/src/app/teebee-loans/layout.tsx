// /teebee-loans — Tee Bee Accountants loan-preparation workspace.
import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.curriculate.net"),
  title: {
    template: "%s · Tee Bee Loans",
    default: "Tee Bee Loans — loan-readiness & financing-package prep for PNG SMEs",
  },
  description:
    "Get PNG businesses loan-ready. Score financials against lender benchmarks (liquidity, leverage, DSCR, loan-to-value), close the gaps, and assemble a complete financing package for BSP, Kina, Westpac and microfinance lenders.",
  keywords: [
    "business loan PNG", "SME finance PNG", "loan readiness PNG",
    "DSCR PNG", "financing package PNG", "Tee Bee Accountants loans",
    "BSP loan", "Kina Bank loan", "bank loan application PNG", "loan preparation accountant PNG",
  ],
  authors: [{ name: "Tee Bee Accountants Ltd", url: "https://www.curriculate.net/teebee" }],
  creator: "Tee Bee Accountants Ltd",
  publisher: "Tee Bee Accountants Ltd",
  alternates: { canonical: "https://www.curriculate.net/teebee-loans" },
  robots: { index: true, follow: true },
  category: "Business Software",
};

export default function TeebeeLoansLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="loans-host" strategy="beforeInteractive">
        {`document.body.classList.add('teebeepay-host');`}
      </Script>
      {children}
    </>
  );
}
