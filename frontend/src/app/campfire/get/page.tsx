"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CAMPFIRE_IOS_URL,
  CAMPFIRE_ANDROID_URL,
  CAMPFIRE_ANDROID_LIVE,
} from "@/lib/campfire/appLinks";

// "Get the Campfire app" — the single landing page every email links to. Detects the
// visitor's device and leads with the right option: iPhone → App Store, Android → the app
// when it's live (else the web app + "coming soon"), desktop → both. Everyone can always
// fall back to the full web app.
type Platform = "ios" | "android" | "other";

export default function GetCampfirePage() {
  const [platform, setPlatform] = useState<Platform>("other");

  useEffect(() => {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) setPlatform("ios");
    else if (/Android/i.test(ua)) setPlatform("android");
    else setPlatform("other");
  }, []);

  const iosBtn = (
    <a
      href={CAMPFIRE_IOS_URL}
      className="block w-full rounded-2xl bg-slate-900 px-6 py-4 text-center text-base font-bold text-white hover:bg-slate-800"
    >
       Download on the App Store
    </a>
  );

  const androidBtn = CAMPFIRE_ANDROID_LIVE ? (
    <a
      href={CAMPFIRE_ANDROID_URL}
      className="block w-full rounded-2xl bg-slate-900 px-6 py-4 text-center text-base font-bold text-white hover:bg-slate-800"
    >
      ▶ Get it on Google Play
    </a>
  ) : (
    <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-6 py-4 text-center text-base font-semibold text-slate-400">
      ▶ Google Play — coming soon
    </div>
  );

  const webBtn = (
    <Link
      href="/campfirelive"
      className="block w-full rounded-2xl bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-4 text-center text-base font-bold text-white hover:opacity-90"
    >
      Open Campfire in your browser
    </Link>
  );

  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center text-slate-700">
      <div className="text-6xl mb-3">🔥</div>
      <h1 className="text-3xl font-extrabold bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
        Get Campfire
      </h1>
      <p className="mt-3 text-slate-600">
        Your groups, in your pocket. Faster notifications, one-tap open, and the same warm
        moments — get the app.
      </p>

      <div className="mt-8 space-y-3">
        {platform === "ios" && (
          <>
            {iosBtn}
            {webBtn}
          </>
        )}
        {platform === "android" && (
          <>
            {androidBtn}
            {webBtn}
          </>
        )}
        {platform === "other" && (
          <>
            {iosBtn}
            {androidBtn}
            {webBtn}
          </>
        )}
      </div>

      <p className="mt-8 text-xs text-slate-400">
        Prefer no download? Campfire works right in your browser — and you can add it to your
        home screen from there too.
      </p>
    </main>
  );
}
