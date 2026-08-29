"use client";

// In-app "rate us" nudge. Fights the cold-start 0-ratings problem that tanks store
// ranking. Shown ONLY in the native app (a store rating is meaningless on the web), and
// only after the user has enjoyed a couple of reveals — a real high point, not a cold
// interruption. Fully self-managing via localStorage: never nags, honours "no thanks".
//
// Remote-wrapper friendly: this is web content in the WebView, so it ships by deploy —
// no new binary. iOS → App Store review composer; Android → the Play listing.

import { useEffect, useState } from "react";
import { CAMPFIRE_IOS_URL, CAMPFIRE_ANDROID_URL } from "@/lib/campfire/appLinks";

const K = {
  rated: "campfire_rated",
  dismissed: "campfire_rate_dismissed",
  snooze: "campfire_rate_snooze_until",
  count: "campfire_reveals_seen_count",
};
const REVEALS_BEFORE_ASK = 2; // let them feel the value first
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // "maybe later" = 2 weeks

type Cap = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: { Browser?: { open?: (o: { url: string }) => Promise<void> } };
};
function cap(): Cap | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: Cap }).Capacitor ?? null;
}
const ls = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked — just skip persisting */
    }
  },
};

export default function RateNudge({ active }: { active: boolean }) {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState("");

  useEffect(() => {
    if (!active) return;
    const c = cap();
    if (!c?.isNativePlatform?.()) return; // store rating only makes sense in the app
    setPlatform(c.getPlatform?.() ?? "");

    if (ls.get(K.rated) || ls.get(K.dismissed)) return;
    const snooze = Number(ls.get(K.snooze) || 0);
    if (snooze && Date.now() < snooze) return;

    // Count reveals viewed; only ask once they've seen a few.
    const n = Number(ls.get(K.count) || 0) + 1;
    ls.set(K.count, String(n));
    if (n < REVEALS_BEFORE_ASK) return;

    const t = setTimeout(() => setShow(true), 1600); // let the reveal land first
    return () => clearTimeout(t);
  }, [active]);

  if (!show) return null;

  const openStore = () => {
    const url =
      platform === "android"
        ? CAMPFIRE_ANDROID_URL
        : `${CAMPFIRE_IOS_URL.split("?")[0]}?action=write-review`;
    const c = cap();
    if (c?.Plugins?.Browser?.open) c.Plugins.Browser.open({ url });
    else window.open(url, "_blank");
    ls.set(K.rated, "1");
    setShow(false);
  };
  const later = () => {
    ls.set(K.snooze, String(Date.now() + SNOOZE_MS));
    setShow(false);
  };
  const never = () => {
    ls.set(K.dismissed, "1");
    setShow(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] p-4" role="dialog" aria-label="Rate Campfire">
      <div className="mx-auto max-w-sm rounded-2xl border border-orange-200 bg-white p-4 shadow-xl">
        <div className="text-center text-3xl">🔥</div>
        <p className="mt-1 text-center text-sm font-bold text-slate-900">Enjoying Campfire?</p>
        <p className="mt-1 text-center text-xs text-slate-500">
          A quick rating helps other groups find us — it takes about 10 seconds 💛
        </p>
        <div className="mt-3 space-y-2">
          <button
            onClick={openStore}
            className="w-full rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2.5 text-sm font-bold text-white hover:opacity-90"
          >
            Rate Campfire ⭐
          </button>
          <div className="flex gap-2">
            <button
              onClick={later}
              className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              Maybe later
            </button>
            <button
              onClick={never}
              className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              No thanks
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
