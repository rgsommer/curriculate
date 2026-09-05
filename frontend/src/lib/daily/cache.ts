import type { Payload } from "./parse";

// Process-local copy of the parsed sheet, shared by /api/daily and
// /api/daily/ping. On Vercel each warm function instance has its own copy;
// with one classroom screen polling, traffic stays on one instance, and the
// CACHE_MAX_AGE_MS fallback in the GET route bounds the lag in any case.
export const dailyCache: { body: Payload | null; at: number; dirty: boolean; version: number } = {
  body: null,
  at: 0,
  dirty: false,
  version: 0,
};
