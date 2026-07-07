import { useEffect, useRef } from "react";

/**
 * useServerEventTimeout
 *
 * Shared safety hook for tasks that wait on a server/teacher socket event to
 * advance a phase — spotlight assignment, race:start, an AI verdict, a state
 * broadcast, etc. In a real classroom those events can fail to arrive (WiFi
 * drop, no teacher orchestrating, too few players, a race). Without a timeout
 * the task sits in a dead phase forever (the "P1" pattern from the stuck-state
 * audit).
 *
 * This hook fires `onTimeout` if the awaited event hasn't resolved within
 * `timeoutMs`. The task supplies its own recovery in `onTimeout` — usually
 * one of:
 *   - re-request state from the server (a nudge), then
 *   - fall back to a local solo/practice/synthesized flow so the student can
 *     always keep playing.
 *
 * @param {object}   opts
 * @param {boolean}  opts.armed      True while the task is in the server-gated
 *                                   phase (waiting). Set false once the awaited
 *                                   event arrives — that disarms the timer.
 * @param {number}   [opts.timeoutMs=12000]
 * @param {any}      [opts.resetKey] Change this to restart the timer (e.g. a
 *                                   new round index) without unmounting.
 * @param {Function} opts.onTimeout  Called once if still armed at timeout.
 */
export function useServerEventTimeout({ armed, timeoutMs = 12000, resetKey, onTimeout }) {
  const cbRef = useRef(onTimeout);
  cbRef.current = onTimeout;

  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => {
      try {
        if (typeof cbRef.current === "function") cbRef.current();
      } catch (e) {
        // Never let a recovery callback throw out of the timer.
        // eslint-disable-next-line no-console
        console.warn("[useServerEventTimeout] onTimeout threw:", e?.message || e);
      }
    }, Math.max(0, Number(timeoutMs) || 0));
    return () => clearTimeout(id);
  }, [armed, timeoutMs, resetKey]);
}

export default useServerEventTimeout;
