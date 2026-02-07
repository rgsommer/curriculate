// backend/utils/noiseTelemetry.js
// Collects class-level noise samples during a live session and produces summary stats for reports.
// Safe to use even if noise is disabled or no samples exist.

export const DEFAULT_NOISE_SAMPLE_CAP = 1200; // ~20 minutes @ 1 sample/sec

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function nowMs() {
  return Date.now();
}

/**
 * Normalize a noise level value to 0..1.
 * Accepts either 0..1 floats OR 0..100 values.
 */
export function normalizeNoiseLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 0;
  if (n > 1.01) return clamp01(n / 100);
  return clamp01(n);
}

/**
 * Record a noise sample on the room state object.
 * Mutates `room` by appending to room.noiseSamples.
 *
 * @param {object} room - The in-memory room/session state object.
 * @param {object} sample - { level, brightness, enabled, threshold }
 * @param {object} [opts] - { cap, tsMs }
 */
export function recordNoiseSample(room, sample = {}, opts = {}) {
  if (!room || typeof room !== "object") return;

  const enabled = Boolean(sample.enabled ?? room?.noiseControl?.enabled ?? room?.noise?.enabled);
  const thresholdRaw = sample.threshold ?? room?.noiseControl?.threshold ?? room?.noise?.threshold;
  const threshold = normalizeNoiseLevel(thresholdRaw);

  // Always track enabled/threshold for reporting even if disabled (helps explain “why no data”).
  room.noiseControl = room.noiseControl || {};
  room.noiseControl.enabled = enabled;
  if (Number.isFinite(Number(thresholdRaw))) room.noiseControl.threshold = thresholdRaw;

  // If noise control is disabled, we still may want to keep a minimal record of last-seen level,
  // but we won't grow the samples array.
  const lvl = normalizeNoiseLevel(sample.level ?? room?.noise?.level ?? 0);
  const brightness = clamp01(sample.brightness ?? room?.noise?.brightness ?? 1);

  room.noise = room.noise || {};
  room.noise.level = lvl;
  room.noise.brightness = brightness;
  room.noise.enabled = enabled;
  room.noise.threshold = thresholdRaw;

  // If you want to record samples even when disabled, flip this to `if (true)`.
  if (!enabled) return;

  const tsMs = Number.isFinite(Number(opts.tsMs)) ? Number(opts.tsMs) : nowMs();
  const cap = Number.isFinite(Number(opts.cap)) ? Number(opts.cap) : DEFAULT_NOISE_SAMPLE_CAP;

  if (!Array.isArray(room.noiseSamples)) room.noiseSamples = [];

  room.noiseSamples.push({
    t: tsMs,
    level: lvl,
    brightness,
    threshold,
  });

  // Cap array growth to avoid memory leaks on long-running rooms.
  if (room.noiseSamples.length > cap) {
    room.noiseSamples.splice(0, room.noiseSamples.length - cap);
  }
}

/**
 * Compute a noise summary from a samples array.
 * @param {Array} samples - array of {t, level, brightness, threshold}
 * @param {object} [fallback] - { enabled, threshold }
 */
export function computeNoiseSummary(samples, fallback = {}) {
  const enabled = Boolean(fallback.enabled);
  const thr = normalizeNoiseLevel(fallback.threshold);

  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      enabled,
      threshold: thr,
      sampleCount: 0,
      durationSeconds: 0,
      avg: null,
      peak: null,
      pctOverThreshold: null,
    };
  }

  let sum = 0;
  let peak = 0;
  let over = 0;

  const firstT = Number(samples[0]?.t) || nowMs();
  const lastT = Number(samples[samples.length - 1]?.t) || firstT;
  const durationSeconds = Math.max(0, Math.round((lastT - firstT) / 1000));

  for (const s of samples) {
    const lvl = normalizeNoiseLevel(s?.level);
    sum += lvl;
    if (lvl > peak) peak = lvl;
    if (lvl > thr) over += 1;
  }

  const avg = sum / samples.length;
  const pctOverThreshold = samples.length ? over / samples.length : 0;

  return {
    enabled: true,
    threshold: thr,
    sampleCount: samples.length,
    durationSeconds,
    avg,
    peak,
    pctOverThreshold,
  };
}
