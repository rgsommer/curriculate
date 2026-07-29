// Central place for Campfire app-store links + the "get the app" landing URL, so every
// email/page references one source of truth. iOS is LIVE; Android is gated behind a flag
// until the Play resubmission is approved (avoids sending people to a dead Play listing).

// Real App Store URL. Set NEXT_PUBLIC_CAMPFIRE_IOS_URL on Vercel, or replace the fallback
// once known. (Placeholder search link keeps it non-broken until then.)
export const CAMPFIRE_IOS_URL =
  process.env.NEXT_PUBLIC_CAMPFIRE_IOS_URL ||
  "https://apps.apple.com/us/app/campfire-gather-your-group/id0000000000";

export const CAMPFIRE_ANDROID_PACKAGE = "net.curriculate.campfire";
export const CAMPFIRE_ANDROID_URL = `https://play.google.com/store/apps/details?id=${CAMPFIRE_ANDROID_PACKAGE}`;

// Flip to "1" the day the Play app is approved to turn the Android button live.
export const CAMPFIRE_ANDROID_LIVE =
  process.env.NEXT_PUBLIC_CAMPFIRE_ANDROID_LIVE === "1";

// The stable landing URL emails link to. base is the public site origin.
export function campfireGetAppUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/campfire/get`;
}
