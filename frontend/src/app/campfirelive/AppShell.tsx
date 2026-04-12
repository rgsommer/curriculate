"use client";

import { AuthProvider, useAuth } from "@/lib/campfire/AuthProvider";
import Link from "next/link";
import { usePathname } from "next/navigation";

function Shell({ children }: { children: React.ReactNode }) {
  const { user, profile, isTrialActive, trialDaysLeft, signOut, loading } = useAuth();
  const pathname = usePathname();

  // Auth pages don't need the shell
  if (pathname.startsWith("/campfirelive/auth") || pathname.startsWith("/campfirelive/join")) {
    return <>{children}</>;
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">🔥</div>
          <div className="text-slate-500">Loading Campfire...</div>
        </div>
      </div>
    );
  }

  // Not logged in → redirect to auth
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-4">🔥</div>
          <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Campfire</h1>
          <p className="text-slate-600 mb-6">
            Sign in to start engaging with your groups.
          </p>
          <Link
            href="/campfirelive/auth"
            className="inline-block rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-8 py-3 text-sm font-bold text-white shadow-md hover:opacity-90"
          >
            Sign In or Sign Up
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50">
      {/* Trial banner */}
      {!profile?.is_premium && isTrialActive && trialDaysLeft <= 14 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800">
          Your free trial ends in <strong>{trialDaysLeft} days</strong>.{" "}
          <Link href="/campfirelive/settings" className="underline font-semibold">
            Upgrade now
          </Link>
        </div>
      )}

      {!isTrialActive && !profile?.is_premium && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-center text-sm text-red-800">
          Your free trial has ended.{" "}
          <Link href="/campfirelive/settings" className="underline font-semibold">
            Upgrade to continue
          </Link>
        </div>
      )}

      {/* Top nav */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
          <Link href="/campfirelive" className="flex items-center gap-2">
            <span className="text-2xl">🔥</span>
            <span className="font-extrabold text-lg bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
              Campfire
            </span>
          </Link>

          <div className="flex items-center gap-4">
            {profile && (
              <span className="text-sm text-slate-600">
                {profile.display_name}
              </span>
            )}
            <button
              onClick={signOut}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
