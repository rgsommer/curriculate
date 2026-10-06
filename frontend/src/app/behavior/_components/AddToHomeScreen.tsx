"use client";

// "Add Compass to your home screen". Where the browser supports it (Chrome /
// Edge / Android / Chromebook) this is ONE tap: it opens the browser's own
// install prompt. iPhone/iPad don't let a website trigger that, so there we
// show the three Share-menu steps. Hidden once Compass is already running from
// the home screen; "Not now" hides it for 30 days.
import { useEffect, useState } from "react";
import { Button } from "./ui";
import { INSTALLABLE_EVENT } from "./InstallCatcher";

const SNOOZE_KEY = "compass_a2hs_snooze";
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

type Platform = "ios" | "inapp" | "android" | "desktop";

function detectPlatform(): Platform {
  const ua = navigator.userAgent || "";
  // Email/social apps' built-in browsers can't add to the home screen (and are
  // the usual reason people get signed out every visit).
  if (/FBAN|FBAV|Instagram|LinkedInApp|GSA\/|Line\/|Outlook|Gmail|; wv\)/i.test(ua)) return "inapp";
  const iPadOS = navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || iPadOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function isStandalone(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
  } catch {
    return false;
  }
}

export default function AddToHomeScreen() {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [canPrompt, setCanPrompt] = useState(false);
  const [steps, setSteps] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      const until = Number(localStorage.getItem(SNOOZE_KEY) || 0);
      if (until && Date.now() < until) return;
    } catch { /* storage blocked — still offer it */ }
    setPlatform(detectPlatform());
    setShow(true);
    const sync = () => setCanPrompt(!!(window as any).__compassInstall);
    sync();
    window.addEventListener(INSTALLABLE_EVENT, sync);
    return () => window.removeEventListener(INSTALLABLE_EVENT, sync);
  }, []);

  if (!show) return null;

  async function add() {
    const evt = (window as any).__compassInstall;
    if (evt) {
      try {
        await evt.prompt();
        const choice = await evt.userChoice;
        (window as any).__compassInstall = null;
        setCanPrompt(false);
        if (choice?.outcome === "accepted") { setDone(true); return; }
      } catch { /* fall through to the manual steps */ }
    }
    setSteps(true);
  }

  function snooze() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* ignore */ }
    setShow(false);
  }

  if (done) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        ✓ Compass is on your home screen. Open it from there and you&apos;ll stay signed in.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <img src="/compass-icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Add Compass to your home screen</p>
          <p className="text-xs text-slate-500">Opens straight to your dashboard, full screen — and keeps you signed in.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={add}>{canPrompt ? "📲 Add" : steps ? "Show steps" : "📲 How to add"}</Button>
          <button type="button" onClick={snooze} className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">Not now</button>
        </div>
      </div>

      {steps && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
          {platform === "inapp" && (
            <>
              <p className="font-medium text-slate-900">First, open this page in your browser</p>
              <p className="mt-1">You&apos;re in an app&apos;s built-in browser (e.g. from an email link), which can&apos;t add to the home screen. Use the <b>⋯</b> or share menu and choose <b>Open in Safari</b> / <b>Open in Chrome</b>, sign in once, then tap this button again.</p>
            </>
          )}
          {platform === "ios" && (
            <ol className="list-decimal space-y-1 pl-5">
              <li>Tap the <b>Share</b> button <span aria-hidden>(□↑)</span> — at the bottom of Safari, or beside the address bar.</li>
              <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
              <li>Tap <b>Add</b>. Then open Compass from your home screen and sign in once.</li>
            </ol>
          )}
          {platform === "android" && (
            <ol className="list-decimal space-y-1 pl-5">
              <li>Tap the browser menu <b>⋮</b> (top right).</li>
              <li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li>
              <li>Tap <b>Install</b> / <b>Add</b>.</li>
            </ol>
          )}
          {platform === "desktop" && (
            <ol className="list-decimal space-y-1 pl-5">
              <li>In Chrome or Edge, click the <b>install icon</b> at the right end of the address bar — or the menu <b>⋮</b> → <b>Cast, save and share</b> → <b>Install page as app</b>.</li>
              <li>In Safari on a Mac: <b>File</b> → <b>Add to Dock</b>.</li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
