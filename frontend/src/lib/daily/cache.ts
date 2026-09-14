import type { Payload } from "./parse";

// Process-local copy of the parsed sheet, shared by /api/daily and
// /api/daily/ping. On Vercel each warm function instance has its own copy;
// with one classroom screen polling, traffic stays on one instance, and the
// CACHE_MAX_AGE_MS fallback in the GET route bounds the lag in any case.
// `blockedUntil` is set when Sheets answers 429: until it passes, the cached
// copy is served without touching the API, so a quota trip does not turn into a
// storm of retries that keeps the quota tripped.
export const dailyCache: {
  body: Payload | null;
  at: number;
  dirty: boolean;
  version: number;
  blockedUntil: number;
  // Ranges the sheet's own slot rules named that the fixed reads do not cover —
  // the tab a rule indexes its pictures out of, say. Discovered from the
  // formulas on one read and folded into the values batch from then on, so
  // finding them costs one extra request once rather than one every refresh.
  extraRanges: string[];
} = {
  body: null,
  at: 0,
  dirty: false,
  version: 0,
  blockedUntil: 0,
  extraRanges: [],
};
