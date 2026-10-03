"use client";

import { AuthProvider, useAuth } from "@/lib/campfire/AuthProvider";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/campfire/supabase";
import { CHECKOUT_LIVE } from "@/lib/campfire/premium";
import GuestUpgrade from "./GuestUpgrade";
import { CF_PRIMARY } from "@/lib/campfire/ui";

// Header account menu: an always-visible avatar (44px) with Settings, Features and
// Sign out — so phone users can reach Settings (incl. account deletion), and sign-out
// is no longer a tiny one-tap link. Guests get a warning first: signing out of a guest
// account loses it for good.
function AccountMenu() {
  const { profile, isGuest, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmGuest, setConfirmGuest] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmGuest(false);
      }
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const name = profile?.display_name || "You";
  const initial = name.trim().charAt(0).toUpperCase() || "🙂";
  const item =
    "flex w-full items-center gap-3 px-4 py-3 text-left text-base text-slate-700 hover:bg-orange-50";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setConfirmGuest(false);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-11 items-center gap-2 rounded-full pl-1 pr-3 hover:bg-slate-100"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-sm font-bold text-white">
          {initial}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-medium text-slate-700 sm:inline">
          {name}
        </span>
        <span aria-hidden className="text-xs text-slate-500">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
        >
          {confirmGuest ? (
            <div className="p-4">
              <p className="text-sm font-semibold text-slate-900">Sign out of this guest account?</p>
              <p className="mt-1 text-sm text-slate-600">
                Guest accounts live only on this device. If you sign out, you won&apos;t be
                able to get back into your groups. Save your account with an email first to
                keep it.
              </p>
              {/* The "save your account" banner (GuestUpgrade) sits right under the
                  header on every page — close the menu and bring it into view. */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setConfirmGuest(false);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className={`${CF_PRIMARY} mt-3 w-full`}
              >
                Save my account first
              </button>
              <button
                type="button"
                onClick={signOut}
                className="mt-2 w-full rounded-xl px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Sign out anyway
              </button>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="truncate font-semibold text-slate-900">{name}</div>
                {isGuest && <div className="text-xs text-slate-500">Guest on this device</div>}
              </div>
              <Link
                role="menuitem"
                href="/campfirelive/settings"
                onClick={() => setOpen(false)}
                className={item}
              >
                <span aria-hidden>⚙️</span> Settings
              </Link>
              <Link
                role="menuitem"
                href="/aboutcampfire"
                onClick={() => setOpen(false)}
                className={item}
              >
                <span aria-hidden>✨</span> Features
              </Link>
              <button
                role="menuitem"
                type="button"
                onClick={() => (isGuest ? setConfirmGuest(true) : signOut())}
                className={`${item} border-t border-slate-100 text-slate-600`}
              >
                <span aria-hidden>↩︎</span> Sign out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, profile, isTrialActive, trialDaysLeft, loading } = useAuth();
  const pathname = usePathname();

  // Remember a referral code from the link (?ref=CODE) so a group created later is
  // attributed to that partner.
  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      const ref = qs.get("ref");
      if (ref) localStorage.setItem("campfire_ref", ref.slice(0, 40));
      // Deep link from a social post: pre-load a template once a group exists.
      const start = qs.get("start");
      if (start) localStorage.setItem("campfire_start", start.slice(0, 40));
    } catch {
      /* ignore */
    }
  }, []);

  // Trial/upgrade messaging is for HOSTS only (members and guests are always free),
  // and only once checkout actually works.
  const [isHost, setIsHost] = useState(false);
  useEffect(() => {
    if (!CHECKOUT_LIVE || !user?.id) return;
    let cancelled = false;
    supabase
      .from("groups")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", user.id)
      .then(({ count }) => {
        if (!cancelled) setIsHost((count ?? 0) > 0);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  const showUpgrade = CHECKOUT_LIVE && isHost && !profile?.is_premium;

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
            className={`${CF_PRIMARY}`}
          >
            Sign In or Sign Up
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50">
      {/* Top nav — first, so in the native shell it (not a banner) owns the notch area. */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
          <Link href="/campfirelive" className="flex items-center gap-2">
            <span className="text-2xl">🔥</span>
            <span className="font-extrabold text-lg bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
              Campfire
            </span>
          </Link>
          <AccountMenu />
        </div>
      </header>

      {/* Guest: prompt to save the account for cross-device access */}
      <GuestUpgrade />

      {/* Trial banners — hosts only, and only once checkout is live. Hidden in the
          iOS app (App Store 3.1.1) and the Android app (Play "no financial features"). */}
      {showUpgrade && isTrialActive && trialDaysLeft <= 14 && (
        <div data-hide-on-ios data-hide-on-android className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800">
          Your free trial ends in <strong>{trialDaysLeft} days</strong>.{" "}
          <Link href="/campfirelive/settings" className="underline font-semibold">
            Upgrade now
          </Link>
        </div>
      )}
      {showUpgrade && !isTrialActive && (
        <div data-hide-on-ios data-hide-on-android className="bg-red-50 border-b border-red-200 px-4 py-2 text-center text-sm text-red-800">
          Your free trial has ended.{" "}
          <Link href="/campfirelive/settings" className="underline font-semibold">
            Upgrade to continue
          </Link>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

      {/* Attribution — Campfire is operated by the corporation, and group cards /
          gifts are organized by participants (not any school or its staff). Its large
          bottom padding keeps the floating Feedback button clear of real content. */}
      <footer className="mx-auto max-w-5xl px-4 pb-24 pt-2 text-center text-xs leading-relaxed text-slate-500">
        Campfire is operated by{" "}
        <span className="font-medium text-slate-600">10323594 Canada Corp</span> — a
        company separate from any school or its staff. Group cards, gifts, and
        contributions are organized by the participants themselves.
      </footer>
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
