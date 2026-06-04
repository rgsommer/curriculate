// backend/jobs/subsEscalation.js
//
// Runs the /subs escalation engine on the live server. A lightweight
// timer sweeps for due offers on a fixed cadence and advances any request
// whose pending offer has elapsed — so escalation fires reliably even if
// no teacher ever responds, and survives a server restart because all
// state lives in MongoDB (the sweep simply resumes from the persisted
// offers).
//
// The default sweep interval is short (20s) so the urgent mode's 5-minute
// escalations land close to on time. The non-urgent (multi-hour) mode is
// unaffected by the sweep granularity.
//
// Exposes a singleton engine bound to the Mongo store + real notifier so
// the route handlers (accept/decline, dev tick) drive the same instance.

import { createEngine } from "../services/subsEngine.js";
import { createMongoStore } from "../services/subsMongoStore.js";
import { notifier } from "../services/subsNotify.js";

let engineSingleton = null;
let timer = null;

export function getSubsEngine() {
  if (!engineSingleton) {
    engineSingleton = createEngine({ store: createMongoStore(), notifier });
  }
  return engineSingleton;
}

// Force one sweep right now (used by the dev /tick endpoint). Returns the
// sweep summary { scanned, advanced }.
export async function tickNow() {
  return getSubsEngine().sweep();
}

export function startSubsEscalation(intervalMs = Number(process.env.SUBS_SWEEP_MS) || 20_000) {
  const engine = getSubsEngine();
  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    try {
      const r = await engine.sweep();
      if (r.advanced > 0) {
        console.log(`[subs:escalation] swept ${r.scanned} open request(s), advanced ${r.advanced}`);
      }
    } catch (err) {
      console.error("[subs:escalation] sweep error:", err?.message || err);
    }
  }, intervalMs);
  // Don't keep the event loop alive solely for this timer.
  if (timer.unref) timer.unref();
  console.log(`[subs:escalation] sweep started — every ${Math.round(intervalMs / 1000)}s`);
  return timer;
}

export function stopSubsEscalation() {
  if (timer) clearInterval(timer);
  timer = null;
}
