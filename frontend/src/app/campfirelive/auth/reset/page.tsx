"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/campfire/supabase";
import { CF_PRIMARY } from "@/lib/campfire/ui";

// "Choose a new password" — the landing page for the reset email. The link signs the
// user in with a short-lived recovery session (tokens in the URL fragment, picked up
// by supabase-js); here they set the new password while that session is live.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<"checking" | "ok" | "expired">("checking");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let settled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        settled = true;
        setReady("ok");
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        settled = true;
        setReady("ok");
      }
    });
    // No session after a few seconds → the link was used already or has expired.
    const t = setTimeout(() => {
      if (!settled) setReady("expired");
    }, 4000);
    return () => {
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, []);

  const save = async () => {
    setErr("");
    if (pw.length < 6) return setErr("Use at least 6 characters.");
    if (pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      setErr(
        /same|different/i.test(error.message)
          ? "That's your current password — pick a new one."
          : "Couldn't save the new password. Request a fresh reset link and try again."
      );
      return;
    }
    setDone(true);
    setTimeout(() => router.replace("/campfirelive"), 1500);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 flex items-center justify-center p-6">
      <div className="max-w-sm w-full">
        <div className="text-center mb-6">
          <div className="text-5xl mb-2">🔥</div>
          <h1 className="text-2xl font-extrabold text-slate-900">Choose a new password</h1>
        </div>

        {ready === "checking" ? (
          <p className="text-center text-slate-500 animate-pulse">One sec…</p>
        ) : ready === "expired" ? (
          <div className="text-center">
            <p className="text-slate-600 mb-5">
              This reset link has expired or was already used. Request a new one from the
              sign-in screen.
            </p>
            <Link
              href="/campfirelive/auth"
              className={`${CF_PRIMARY}`}
            >
              Back to sign in
            </Link>
          </div>
        ) : done ? (
          <p className="text-center text-emerald-700 font-semibold">
            ✓ Password updated — taking you to Campfire…
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="new-pw" className="block text-sm font-medium text-slate-700 mb-1">
                New password
              </label>
              <input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-pw2" className="block text-sm font-medium text-slate-700 mb-1">
                Type it again
              </label>
              <input
                id="new-pw2"
                type="password"
                autoComplete="new-password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
              />
            </div>
            {err && (
              <p role="alert" className="text-sm text-red-600">
                {err}
              </p>
            )}
            <button
              onClick={save}
              disabled={busy || !pw || !pw2}
              className={`${CF_PRIMARY} w-full`}
            >
              {busy ? "Saving…" : "Save new password"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
