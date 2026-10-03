"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";
import type { Profile } from "./types";
import type { User, Session } from "@supabase/supabase-js";
import { isNative, openInSystemBrowser, stashOAuthNext } from "./native";

// Deep link the system browser returns to after OAuth in the native shell.
const NATIVE_CALLBACK = "campfire://auth-callback";

interface AuthState {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  isTrialActive: boolean;
  trialDaysLeft: number;
  signUp: (email: string, password: string, displayName: string, next?: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: (next?: string) => Promise<void>;
  signInWithApple: (next?: string) => Promise<void>;
  signInAsGuest: (
    displayName: string
  ) => Promise<{ error: string | null; rateLimited?: boolean }>;
  isGuest: boolean;
  linkGoogle: () => Promise<{ error: string | null }>;
  upgradeWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  session: null,
  loading: true,
  isTrialActive: false,
  trialDaysLeft: 0,
  signUp: async () => ({ error: null }),
  signIn: async () => ({ error: null }),
  signInWithGoogle: async () => {},
  signInWithApple: async () => {},
  signInAsGuest: async () => ({ error: null }),
  isGuest: false,
  linkGoogle: async () => ({ error: null }),
  upgradeWithEmail: async () => ({ error: null }),
  resetPassword: async () => ({ error: null }),
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) setProfile(data as Profile);
  }, []);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) fetchProfile(s.user.id);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) fetchProfile(s.user.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // Trial logic
  const trialEndsAt = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  const now = new Date();
  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;
  const isTrialActive = profile?.is_premium || trialDaysLeft > 0;

  const callbackUrl = (next?: string) =>
    `${window.location.origin}/campfirelive/auth/callback${
      next ? `?next=${encodeURIComponent(next)}` : ""
    }`;

  const signUp = async (email: string, password: string, displayName: string, next?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: callbackUrl(next),
      },
    });
    return { error: error?.message ?? null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  // Google AND Apple share the same flow. Sign in with Apple is required by App Store
  // Guideline 4.8 whenever a third-party (Google) login is offered.
  const signInWithProvider = async (provider: "google" | "apple", next?: string) => {
    // In the Capacitor native shell, OAuth is blocked inside the embedded webview — open
    // the consent page in the SYSTEM browser and let it deep-link back via
    // campfire://auth-callback (NativeBridge sets the session on return). The system
    // browser can't carry `next`, so park it for NativeBridge to pick up on return.
    if (isNative()) {
      stashOAuthNext(next);
      const { data } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: NATIVE_CALLBACK, skipBrowserRedirect: true },
      });
      if (data?.url) await openInSystemBrowser(data.url);
      return;
    }
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl(next) },
    });
  };
  const signInWithGoogle = (next?: string) => signInWithProvider("google", next);
  const signInWithApple = (next?: string) => signInWithProvider("apple", next);

  // No-account class join: an anonymous session carrying just a display name.
  // (Requires "Allow anonymous sign-ins" enabled in Supabase Auth settings.)
  const signInAsGuest = async (displayName: string) => {
    const { error } = await supabase.auth.signInAnonymously({
      options: { data: { display_name: displayName } },
    });
    if (!error) return { error: null, rateLimited: false };
    // A whole class shares one school IP, so Supabase's per-IP anonymous rate
    // limit trips and later kids fail — flag that so the UI can say "wait & retry"
    // instead of "guest mode is off".
    const rateLimited =
      error.status === 429 || /rate.?limit|too many/i.test(error.message);
    return { error: error.message, rateLimited };
  };

  // Guest = anonymous account (device-bound, no email/password yet).
  const isGuest = !!user?.is_anonymous;

  // Upgrade a guest to a permanent account — keeps the SAME user id, so all
  // group memberships and history carry over. They can then log in elsewhere.
  const linkGoogle = async () => {
    // Native shell: Google refuses embedded webviews, so link through the system
    // browser + deep link, exactly like sign-in, and come back to the current page.
    if (isNative()) {
      stashOAuthNext(window.location.pathname + window.location.search);
      const { data, error } = await supabase.auth.linkIdentity({
        provider: "google",
        options: { redirectTo: NATIVE_CALLBACK, skipBrowserRedirect: true },
      });
      if (data?.url) await openInSystemBrowser(data.url);
      return { error: error?.message ?? null };
    }
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    return { error: error?.message ?? null };
  };

  // Email + password reset. The link lands on the auth callback (already an allowed
  // redirect), which signs the user in with a recovery session and forwards them to
  // the "choose a new password" page.
  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: callbackUrl("/campfirelive/auth/reset"),
    });
    return { error: error?.message ?? null };
  };

  const upgradeWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.updateUser({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setSession(null);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        loading,
        isTrialActive,
        trialDaysLeft,
        signUp,
        signIn,
        signInWithGoogle,
        signInWithApple,
        signInAsGuest,
        isGuest,
        linkGoogle,
        upgradeWithEmail,
        resetPassword,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
