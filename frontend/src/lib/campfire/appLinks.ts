// Central place for Campfire app-store links + the "get the app" landing URL, so every
// email/page references one source of truth. iOS is LIVE; Android is gated behind a flag
// until the Play resubmission is approved (avoids sending people to a dead Play listing).

// Live App Store listing (App Store ID 6786055943, confirmed via itunes lookup).
// Env override kept for flexibility.
export const CAMPFIRE_IOS_URL =
  process.env.NEXT_PUBLIC_CAMPFIRE_IOS_URL ||
  "https://apps.apple.com/us/app/campfire-gather-your-group/id6786055943";

export const CAMPFIRE_ANDROID_PACKAGE = "net.curriculate.campfire";
export const CAMPFIRE_ANDROID_URL = `https://play.google.com/store/apps/details?id=${CAMPFIRE_ANDROID_PACKAGE}`;

// Play app is published and live. Live by default; set NEXT_PUBLIC_CAMPFIRE_ANDROID_LIVE="0"
// to force the "coming soon" state back (e.g. if the listing is ever pulled).
export const CAMPFIRE_ANDROID_LIVE =
  process.env.NEXT_PUBLIC_CAMPFIRE_ANDROID_LIVE !== "0";

// The stable landing URL emails link to. base is the public site origin.
export function campfireGetAppUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/campfire/get`;
}
