"use client";

import { useState } from "react";
import { useAuth } from "@/lib/campfire/AuthProvider";

// Prompts a guest (anonymous) member to save their account so they can sign in
// from any device. Upgrading keeps the same account + group memberships.
export default function GuestUpgrade() {
  const { isGuest, linkGoogle, upgradeWithEmail } = useAuth();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!isGuest) return null;

  const doGoogle = async () => {
    setBusy(true);
    const { error } = await linkGoogle();
    if (error) {
      setMsg(error);
      setBusy(false);
    }
    // success → redirects to Google
  };

  const doEmail = async () => {
    if (!email.trim() || password.length < 6) {
      setMsg("Enter an email and a password of at least 6 characters.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const { error } = await upgradeWithEmail(email.trim(), password);
    setBusy(false);
    if (error) {
      setMsg(error);
      return;
    }
    setMsg(
      "✓ Saved! Check your email to confirm the address — then you can sign in from any device."
    );
  };

  return (
    <>
      {/* Slim banner */}
      {!dismissed && (
        <div className="bg-violet-50 border-b border-violet-200 px-4 py-2 text-center text-sm text-violet-800">
          You&apos;re a guest — this account only lives on this device.{" "}
          <button onClick={() => setOpen(true)} className="underline font-semibold">
            Save your account
          </button>{" "}
          to log in anywhere.
          <button
            onClick={() => setDismissed(true)}
            className="ml-2 text-violet-400 hover:text-violet-600"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-4">
              <div className="text-4xl mb-1">💾</div>
              <h2 className="text-lg font-extrabold text-slate-900">Save your account</h2>
              <p className="text-xs text-slate-500 mt-1">
                Keeps everything you&apos;re in — and lets you sign in from another phone
                or computer.
              </p>
            </div>

            <button
              onClick={doGoogle}
              disabled={busy}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Continue with Google
            </button>

            <div className="my-3 flex items-center gap-2 text-xs text-slate-400">
              <div className="h-px flex-1 bg-slate-200" /> or email <div className="h-px flex-1 bg-slate-200" />
            </div>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none mb-2"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password (6+ characters)"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none"
            />
            {msg && <p className="mt-2 text-xs text-slate-600">{msg}</p>}
            <button
              onClick={doEmail}
              disabled={busy}
              className="mt-3 w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save account"}
            </button>

            <button
              onClick={() => setOpen(false)}
              disabled={busy}
              className="mt-2 w-full text-xs text-slate-400 hover:text-slate-600"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}
    </>
  );
}
