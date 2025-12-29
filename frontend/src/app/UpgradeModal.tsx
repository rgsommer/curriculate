"use client";

import Link from "next/link";
import { X, Sparkles, Lock } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  feature?: string;
  title?: string;
  subtitle?: string;
  ctaHref?: string;
  ctaLabel?: string;
};

export default function UpgradeModal({
  open,
  onClose,
  feature = "this feature",
  title = "Unlock Teacher Plus",
  subtitle = "Founding Teacher Price · locked forever for early subscribers",
  ctaHref = "/pricing#teacher-plus",
  ctaLabel = "See Teacher Plus",
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-[min(92vw,560px)] rounded-3xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
        <div className="p-6 sm:p-8">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-purple-50 border border-purple-200 flex items-center justify-center">
              <Lock className="w-6 h-6 text-purple-700" />
            </div>
            <div className="flex-1">
              <div className="text-2xl font-black text-gray-900">{title}</div>
              <div className="mt-1 text-gray-700 font-medium">{subtitle}</div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-5">
            <div className="flex items-center gap-2 text-gray-900 font-extrabold">
              <Sparkles className="w-5 h-5 text-yellow-500" />
              <span>Unlock: {feature}</span>
            </div>
            <p className="mt-2 text-gray-700 font-medium">
              Teacher Plus gives you the premium classroom flow: AI tasksets, rich reports, session history, and station posters.
            </p>
            <div className="mt-4 flex items-baseline gap-3">
              <div className="text-3xl font-black text-gray-900">$7.99</div>
              <div className="text-gray-700 font-bold">/ month</div>
              <div className="ml-3 text-gray-600 font-semibold">or $79 / year (2 months free)</div>
            </div>
            <div className="mt-2 text-sm font-bold text-purple-700">Founding Teacher Price (limited time)</div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <Link
              href={ctaHref}
              className="inline-flex items-center justify-center rounded-2xl bg-purple-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-purple-700"
            >
              {ctaLabel}
            </Link>
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
