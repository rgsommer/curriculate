"use client";

import { useEffect, useState } from "react";
import { enablePush, pushStatus } from "@/lib/campfire/nativePush";

const SNOOZE_KEY = "campfire_push_prompt_snoozed_until";
const SNOOZE_MS = 14 * 86400000;

// The ONE place Campfire asks for notification permission: a friendly card, shown in
// the native app to people who are already in a group (so the value is obvious), with
// a sentence on why before the OS dialog. "Not now" snoozes it for two weeks. Renders
// nothing on the web, in binaries without push support, or once decided.
export default function PushPrompt({ inAGroup }: { inAGroup: boolean }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!inAGroup) return;
    let cancelled = false;
    (async () => {
      try {
        const until = Number(localStorage.getItem(SNOOZE_KEY) || 0);
        if (until > Date.now()) return;
      } catch {
        /* no storage → still fine to ask */
      }
      const s = await pushStatus();
      if (!cancelled && s === "prompt") setShow(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [inAGroup]);

  if (!show) return null;

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div className="mb-6 rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-2xl leading-none">🔔</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-900">Know when it&apos;s your turn</div>
          <p className="mt-0.5 text-sm text-slate-600">
            {denied
              ? "Notifications are off for Campfire. You can turn them on any time in your phone's Settings → Campfire → Notifications."
              : "Get a quick nudge when your group posts something new or results are revealed. No spam — just your groups."}
          </p>
          {!denied && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await enablePush();
                  setBusy(false);
                  if (r === "granted") setShow(false);
                  else if (r === "denied") setDenied(true);
                  else snooze();
                }}
                className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? "One sec…" : "Turn on notifications"}
              </button>
              <button
                type="button"
                onClick={snooze}
                className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700"
              >
                Not now
              </button>
            </div>
          )}
        </div>
        {denied && (
          <button
            type="button"
            onClick={snooze}
            aria-label="Dismiss"
            className="-m-2 h-11 w-11 flex-shrink-0 rounded-full text-slate-400 hover:bg-slate-100"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
