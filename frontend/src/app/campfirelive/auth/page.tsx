"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/campfire/AuthProvider";
import Link from "next/link";

export default function AuthPage() {
  const router = useRouter();
  const { signUp, signIn, signInWithGoogle, signInWithApple, signInAsGuest, user } = useAuth();
  const [guestName, setGuestName] = useState("");
  const [guestLoading, setGuestLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  // Where to send the user after they authenticate (e.g. back to a join link).
  // Read from the URL directly to avoid needing a Suspense boundary.
  const rawNext =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("next")
      : null;
  // Only allow in-app relative paths (no open redirects).
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/campfirelive";

  // Already logged in
  if (user) {
    router.push(next);
    return null;
  }

  const handleGuest = async () => {
    if (!guestName.trim()) return;
    setGuestLoading(true);
    setError("");
    const result = await signInAsGuest(guestName.trim());
    if (result.error) {
      setError(
        result.rateLimited
          ? "Lots of people are joining at once — wait about a minute, then tap again. (Or use email below.)"
          : result.error
      );
      setGuestLoading(false);
    } else {
      router.push(next);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (mode === "signup") {
      if (!displayName.trim()) {
        setError("Please enter your name.");
        setLoading(false);
        return;
      }
      const result = await signUp(email, password, displayName.trim(), next);
      if (result.error) {
        setError(result.error);
      } else {
        setConfirmSent(true);
      }
    } else {
      const result = await signIn(email, password);
      if (result.error) {
        setError(result.error);
      } else {
        router.push(next);
      }
    }
    setLoading(false);
  };

  if (confirmSent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="text-5xl mb-4">📬</div>
          <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Check your email</h1>
          <p className="text-slate-600 mb-6">
            We sent a confirmation link to <strong>{email}</strong>. Click it to
            activate your account and start your 3-month free trial.
          </p>
          <Link
            href="/campfirelive/auth"
            onClick={() => { setConfirmSent(false); setMode("signin"); }}
            className="text-sm text-orange-600 underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/aboutcampfire" className="inline-block">
            <div className="text-5xl mb-3">🔥</div>
            <h1 className="text-3xl font-extrabold bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
              Campfire
            </h1>
          </Link>
          <p className="text-slate-500 mt-2">
            {mode === "signin"
              ? "Sign in to your account"
              : "Start your free 3-month trial"}
          </p>
        </div>

        {/* Google sign in */}
        <button
          onClick={() => signInWithGoogle(next)}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 flex items-center justify-center gap-3 mb-3"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </button>

        {/* Apple sign in — required by App Store Guideline 4.8 when Google is offered.
            Gated behind NEXT_PUBLIC_APPLE_SIGNIN so it only appears once Sign in with Apple
            is configured in Supabase + Apple Developer (otherwise the button would error). */}
        {process.env.NEXT_PUBLIC_APPLE_SIGNIN === "1" && (
        <button
          onClick={() => signInWithApple(next)}
          className="w-full rounded-xl bg-black px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-slate-900 flex items-center justify-center gap-2 mb-6"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
            <path d="M17.05 12.04c-.03-2.6 2.13-3.85 2.22-3.91-1.21-1.77-3.09-2.02-3.76-2.05-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.9-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.78 1.3 10.32.86 1.24 1.89 2.63 3.24 2.58 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.02 2.29-1.26 3.14-2.51.99-1.44 1.4-2.83 1.42-2.9-.03-.01-2.73-1.05-2.76-4.16zM14.6 4.6c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.59 3.03-1.46z" />
          </svg>
          Continue with Apple
        </button>
        )}

        {/* Guest / class join — no account, no email */}
        <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-3 mb-6">
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Joining a class or group? Just enter your name:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGuest()}
              placeholder="Your name"
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 outline-none"
            />
            <button
              onClick={handleGuest}
              disabled={guestLoading || !guestName.trim()}
              className="rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {guestLoading ? "…" : "Join"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            No account, no email — the quickest way in.
          </p>
        </div>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-gradient-to-br from-orange-50 via-white to-rose-50 px-3 text-slate-400">
              or
            </span>
          </div>
        </div>

        {/* Email form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Your name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How your group sees you"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
              required
              minLength={6}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {loading
              ? "Please wait..."
              : mode === "signin"
              ? "Sign In"
              : "Create Account — Free for 3 months"}
          </button>
        </form>

        {/* Toggle mode */}
        <p className="text-center text-sm text-slate-500 mt-6">
          {mode === "signin" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => { setMode("signup"); setError(""); }}
                className="text-orange-600 font-semibold underline"
              >
                Sign up free
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => { setMode("signin"); setError(""); }}
                className="text-orange-600 font-semibold underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
