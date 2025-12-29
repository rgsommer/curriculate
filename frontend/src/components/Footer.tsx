// frontend/src/components/Footer.tsx
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-24 border-t bg-white py-10">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-500">
            © 2025{" "}
            <span className="font-semibold text-gray-900">Curriculate.net</span>.
            Built with love for educators.
          </p>

          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <Link className="text-gray-600 hover:text-gray-900" href="/privacy">
              Privacy
            </Link>
            <Link
              className="text-gray-600 hover:text-gray-900"
              href="/termsofservice"
            >
              Terms
            </Link>
            <Link className="text-gray-600 hover:text-gray-900" href="/support">
              Support
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
