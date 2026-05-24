// shared/questPricing.js
//
// Time-based depot price inflation for Quest Mode, shared by the backend
// (authoritative charge at purchase) and the student app (live price display).
//
// Depot prices climb over the session clock so converting strong early
// performance into coins quickly lets a team stock up BEFORE prices rise —
// rewarding "earn early," and making a teammate's surplus look better and
// better as the depot gets expensive. ON BY DEFAULT for Quest (set
// config.priceInflation.enabled = false to turn it off).

/**
 * Resolve the effective inflation settings from a quest config, applying
 * defaults. Inflation is ENABLED unless explicitly set to false.
 * @param {object} cfg - the quest task config
 * @returns {{ enabled: boolean, rate: number, windowSeconds: number }}
 */
export function effectiveInflation(cfg = {}) {
  const pi = cfg && typeof cfg.priceInflation === "object" && cfg.priceInflation ? cfg.priceInflation : {};
  const enabled = pi.enabled !== false; // default ON
  const rate = Number.isFinite(Number(pi.rate)) && Number(pi.rate) >= 0 ? Number(pi.rate) : 0.5; // up to +50%
  const winFromSec = Number(pi.windowSeconds) > 0 ? Math.floor(Number(pi.windowSeconds)) : 0;
  const winFromMin = Number(pi.windowMinutes) > 0 ? Math.floor(Number(pi.windowMinutes) * 60) : 0;
  const windowSeconds = winFromSec || winFromMin || 900; // default 15 min ramp
  return { enabled, rate, windowSeconds };
}

/**
 * Current price multiplier (1.0 at start → 1+rate at/after the window).
 * @param {{enabled:boolean,rate:number,windowSeconds:number}} inflation
 * @param {number|null} startedAtMs - session start (epoch ms)
 * @param {number} nowMs
 */
export function priceMultiplier(inflation, startedAtMs, nowMs = Date.now()) {
  if (!inflation || !inflation.enabled || !startedAtMs) return 1;
  const elapsed = Math.max(0, (Number(nowMs) - Number(startedAtMs)) / 1000);
  const frac = inflation.windowSeconds > 0 ? Math.min(1, elapsed / inflation.windowSeconds) : 0;
  return 1 + inflation.rate * frac;
}

/**
 * Inflated, rounded cost of a base price at the current moment.
 */
export function inflatedCost(baseCost, inflation, startedAtMs, nowMs = Date.now()) {
  const base = Math.max(0, Number(baseCost) || 0);
  return Math.max(0, Math.round(base * priceMultiplier(inflation, startedAtMs, nowMs)));
}

export default { effectiveInflation, priceMultiplier, inflatedCost };
