"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { UserLike } from "./plans";
import { normalizePlan } from "./plans";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

export interface AuthState {
  status: AuthStatus;
  user: UserLike | null;
  refresh: () => Promise<void>;
}

/**
 * Lightweight auth context for the marketing site.
 * - If your backend exposes /api/me (or similar), this will pick it up.
 * - If not, it safely stays anonymous.
 *
 * Later, when Stripe is wired, your webhook sets user.plan, and this context
 * will reflect that immediately.
 */
const AuthContext = createContext<AuthState | null>(null);

async function fetchMe(): Promise<UserLike | null> {
  // Allow an explicit dev override (optional)
  // @ts-expect-error window typing
  const injected = typeof window !== "undefined" ? (window.__CURRICULATE_USER__ as any) : null;
  if (injected && typeof injected === "object") {
    return { ...injected, plan: normalizePlan(injected.plan) };
  }

  try {
    // Try common endpoints. Only one needs to exist.
    const candidates = ["/api/me", "/api/auth/me", "/api/user/me"];
    for (const url of candidates) {
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) continue;
      if (!res.ok) return null;
      const data = await res.json();
      const u = data?.user ?? data;
      if (!u) return null;
      return { ...u, plan: normalizePlan(u.plan) };
    }
    return null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserLike | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const refresh = async () => {
    setStatus("loading");
    const me = await fetchMe();
    if (me) {
      setUser(me);
      setStatus("authenticated");
    } else {
      setUser(null);
      setStatus("anonymous");
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthState>(() => ({ status, user, refresh }), [status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Safe default if someone forgets to wrap (won't crash prod pages)
    return { status: "anonymous", user: null, refresh: async () => {} };
  }
  return ctx;
}
