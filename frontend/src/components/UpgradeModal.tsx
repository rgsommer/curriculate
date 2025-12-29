// frontend/src/components/UpgradeModal.tsx
'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { X, Sparkles, Lock } from 'lucide-react';

export default function UpgradeModal({
  open,
  onClose,
  feature = 'this feature',
}: {
  open: boolean;
  onClose: () => void;
  feature?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-purple-100 text-purple-800 px-3 py-1 text-xs font-bold">
                <Sparkles className="w-4 h-4" />
                Founding Teacher Price
              </div>
              <h3 className="mt-4 text-2xl font-extrabold text-gray-900">Unlock Teacher Plus</h3>
              <p className="mt-2 text-gray-600 font-medium">
                <span className="font-bold">{feature}</span> is included with Teacher Plus.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 hover:bg-gray-100 text-gray-700"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <div className="text-gray-900 font-extrabold">Teacher Plus</div>
                <div className="text-sm text-gray-700 font-semibold">$7.99/month or $79/year (2 months free)</div>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-600 font-medium">
              Early access pricing is limited and will never increase for founding teachers.
            </p>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center w-full gap-3 bg-purple-600 hover:bg-purple-700 text-white font-black py-4 px-6 rounded-2xl shadow"
            >
              Upgrade now
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center w-full gap-3 bg-white hover:bg-gray-50 text-gray-900 font-black py-4 px-6 rounded-2xl shadow border border-gray-200"
            >
              Not yet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
