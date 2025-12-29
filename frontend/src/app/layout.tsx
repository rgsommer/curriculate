import "./globals.css";

export const metadata = {
  title: "Curriculate",
  description: "Curriculate",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
