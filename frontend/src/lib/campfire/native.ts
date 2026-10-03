// Shared access to the Capacitor native shell, reached through the runtime-injected
// `window.Capacitor` so the web bundle never imports Capacitor packages. Every helper
// is a safe no-op in a normal browser.

type Listener = { remove: () => void };
type PushPerm = { receive: "prompt" | "prompt-with-rationale" | "granted" | "denied" };

export type CapPlugins = {
  App?: {
    addListener: (
      ev: string,
      cb: (data: { url?: string }) => void
    ) => Promise<Listener> | Listener;
    getLaunchUrl?: () => Promise<{ url?: string } | undefined>;
  };
  Browser?: { open?: (o: { url: string }) => Promise<void>; close?: () => Promise<void> };
  PushNotifications?: {
    checkPermissions: () => Promise<PushPerm>;
    requestPermissions: () => Promise<PushPerm>;
    register: () => Promise<void>;
    addListener: (ev: string, cb: (data: unknown) => void) => Promise<Listener> | Listener;
  };
};

type Cap = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: CapPlugins;
};

export function cap(): Cap | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: Cap }).Capacitor ?? null;
}

export function isNative(): boolean {
  return !!cap()?.isNativePlatform?.();
}

export function nativePlatform(): "ios" | "android" | null {
  const p = cap()?.getPlatform?.();
  return p === "ios" || p === "android" ? p : null;
}

// Push only works in a binary that carries the native push setup (Firebase config on
// Android, the APNs token hand-off on iOS). Such binaries append "CampfirePush" to the
// WebView user agent (campfire-app/capacitor.config.ts). Older binaries lack it — on
// Android, calling register() there crashes the app, so this check is load-bearing.
export function nativePushCapable(): boolean {
  if (!isNative() || typeof navigator === "undefined") return false;
  return /\bCampfirePush\b/.test(navigator.userAgent) && !!cap()?.Plugins?.PushNotifications;
}

// Open a URL in the system browser (OAuth must not run inside the embedded WebView).
export async function openInSystemBrowser(url: string): Promise<void> {
  const open = cap()?.Plugins?.Browser?.open;
  if (open) await open({ url });
  else window.open(url, "_blank");
}

// Where to land after a native OAuth round-trip. The system browser can't carry our
// in-app destination, so it's parked here before leaving and read back on return.
const NEXT_KEY = "campfire_oauth_next";

export function stashOAuthNext(next: string | null | undefined): void {
  try {
    if (next && isSafeInAppPath(next)) localStorage.setItem(NEXT_KEY, next);
    else localStorage.removeItem(NEXT_KEY);
  } catch {
    /* storage blocked — fall back to the dashboard */
  }
}

export function takeOAuthNext(): string {
  try {
    const v = localStorage.getItem(NEXT_KEY);
    localStorage.removeItem(NEXT_KEY);
    if (v && isSafeInAppPath(v)) return v;
  } catch {
    /* ignore */
  }
  return "/campfirelive";
}

// Only same-site Campfire paths — never an absolute URL or protocol-relative "//…".
export function isSafeInAppPath(p: string): boolean {
  return /^\/(campfirelive|c)(\/|$|\?)/.test(p) && !p.startsWith("//");
}
