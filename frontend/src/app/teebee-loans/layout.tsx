// /teebee-loans — TeeBee Accountants loan-preparation workspace.
import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.curriculate.net"),
  title: {
    template: "%s · TeeBee Loans",
    default: "TeeBee Loans — loan-readiness & financing-package prep for PNG SMEs",
  },
  description:
    "Get PNG businesses loan-ready. Score financials against lender benchmarks (liquidity, leverage, DSCR, loan-to-value), close the gaps, and assemble a complete financing package for BSP, Kina, Westpac and microfinance lenders.",
  keywords: [
    "business loan PNG", "SME finance PNG", "loan readiness PNG",
    "DSCR PNG", "financing package PNG", "TeeBee Accountants loans",
    "BSP loan", "Kina Bank loan", "bank loan application PNG", "loan preparation accountant PNG",
  ],
  authors: [{ name: "TeeBee Accountants Ltd", url: "https://www.curriculate.net/teebee" }],
  creator: "TeeBee Accountants Ltd",
  publisher: "TeeBee Accountants Ltd",
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
