import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In — Curriculate",
  description: "Sign in to your Curriculate account or create a new one.",
  robots: { index: false, follow: false },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
