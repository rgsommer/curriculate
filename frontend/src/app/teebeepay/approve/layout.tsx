// frontend/src/app/teebeepay/approve/layout.tsx — standalone shell, no Curriculate chrome.
import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Approve payroll · TeebeePay",
  description: "Approve a pay period — no sign-in required.",
  robots: { index: false, follow: false },
};

export default function ApproveLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="teebeepay-approve-host" strategy="beforeInteractive">
        {`document.body.classList.add('teebopay-host');`}
      </Script>
      {children}
    </>
  );
}
