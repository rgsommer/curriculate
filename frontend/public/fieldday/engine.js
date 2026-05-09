/**
 * Field Day — pure scoring & helpers engine.
 *
 * Zero DOM, zero state. Works in both the browser (attaches to
 * window.FieldDayEngine) and Node (module.exports). Tested by
 * frontend/public/fieldday/__tests__/engine.test.js.
 *
 * The functions below are the contract. Don't depend on `state` or
 * `api` here — keep them pure so the test suite remains the single
 * source of truth for scoring behaviour.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FieldDayEngine = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PLACE_POINTS = { 1: 5, 2: 4, 3: 3, 4: 2 };
  const COMPLETION_POINTS = 1;

  // ---------- Result helpers ----------
  function bestOf(attempts, type) {
    const nums = (attempts || []).filter(v => v != null && !isNaN(v) && v !== "").map(Number);
    if (nums.length === 0) return null;
    return type === "timed" ? Math.min(...nums) : Math.max(...nums);
  }
  /** Best result for a competitor, treating DQ'd competitors as no-result. */
  function bestOfCompetitor(c, type) {
    if (!c) return null;
    if (c.dq) return null;
    return bestOf(c.attempts, type);
  }
  /** True when an event's wind reading exceeds the IAAF tailwind limit (2.0 m/s). */
  function isWindAided(eventWind) {
    if (eventWind == null || eventWind === "") return false;
    const n = Number(eventWind);
    return !isNaN(n) && n > 2.0;
  }
  function compareResults(a, b, type) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return type === "timed" ? a - b : b - a;
  }
  function pointsForPlace(p) { return PLACE_POINTS[p] != null ? PLACE_POINTS[p] : 0; }

  // ---------- Age & band helpers ----------
  function parseBand(band) {
    const parts = String(band || "").split(/[-–]/).map(s => parseInt(String(s).trim(), 10)).filter(n => !isNaN(n));
    if (parts.length === 1) return [parts[0], parts[0]];
    if (parts.length === 2) return [parts[0], parts[1]];
    return [0, 0];
  }
  function ageInBand(age, range) {
    const [lo, hi] = range;
    const n = parseInt(age, 10);
    return !isNaN(n) && n >= lo && n <= hi;
  }
  function bandForAge(age, ageBands) {
    for (const b of (ageBands || [])) {
      if (ageInBand(age, parseBand(b))) return b;
    }
    return null;
  }
  function divisionForAge(age, divisions) {
    for (const d of (divisions || [])) {
      if (ageInBand(age, d.ageRange || [0, 0])) return d.name;
    }
    return null;
  }
  /**
   * Computes age on a school's cutoff date of the current year.
   * dob: "YYYY-MM-DD"; cutoff: "MM-DD"; returns integer or null.
   */
  function computeAge(dob, cutoff, refYear) {
    if (!dob) return null;
    const dobDate = new Date(String(dob) + "T00:00:00");
    if (isNaN(dobDate.getTime())) return null;
    const [mm, dd] = String(cutoff || "12-31").split("-").map(n => parseInt(n, 10));
    const yr = (typeof refYear === "number" ? refYear : new Date().getFullYear());
    const cutoffDate = new Date(yr, (mm || 12) - 1, dd || 31);
    let age = cutoffDate.getFullYear() - dobDate.getFullYear();
    if (cutoffDate.getMonth() < dobDate.getMonth() ||
        (cutoffDate.getMonth() === dobDate.getMonth() && cutoffDate.getDate() < dobDate.getDate())) age--;
    return age >= 0 ? age : null;
  }

  // ---------- Placement / scoring ----------
  /**
   * Computes placements + points for an event.
   *
   * @param {object} ev
   *   competitors: [{id, attempts: [number|null], actualAge?: string}],
   *   type: "timed" | "distance" | "weight",
   *   age: string (used for fallback band lookup when scoreBy=ageBand),
   *   status: "in_progress" | "completed",
   *   scoreBy: "event" | "ageBand"
   * @param {"average"|"higher"} tieMode
   * @param {string[]} ageBands  (only used when ev.scoreBy === "ageBand")
   * @returns {Array<{competitorId, place, tied, points}>}
   *   `place` is null for those with no result; `points` is COMPLETION_POINTS
   *   for those if the event is completed, 0 otherwise.
   */
  function computePlacements(ev, tieMode = "average", ageBands = []) {
    const groupBy = (ev.scoreBy === "ageBand")
      ? (c) => bandForAge(c.actualAge || ev.age, ageBands) || "_"
      : () => "_";

    const buckets = new Map();
    (ev.competitors || []).forEach(c => {
      const key = groupBy(c);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(c);
    });

    const placements = [];
    for (const [, comps] of buckets) {
      const rows = comps.map(c => ({
        competitorId: c.id,
        best: c.dq ? null : bestOf(c.attempts, ev.type),
        dq:   !!c.dq
      }));
      const withResults = rows.filter(r => r.best != null);
      const noResults   = rows.filter(r => r.best == null);
      withResults.sort((a, b) => compareResults(a.best, b.best, ev.type));

      const tiedGroups = [];
      for (const r of withResults) {
        const last = tiedGroups[tiedGroups.length - 1];
        if (last && last[0].best === r.best) last.push(r); else tiedGroups.push([r]);
      }
      let curPlace = 1;
      for (const group of tiedGroups) {
        const span = group.length;
        const used = []; for (let i = 0; i < span; i++) used.push(curPlace + i);
        group.forEach(r => {
          let assignedPlace, points;
          if (tieMode === "higher") {
            assignedPlace = curPlace;
            points = pointsForPlace(curPlace);
          } else {
            assignedPlace = curPlace;
            const total = used.reduce((s, p) => s + pointsForPlace(p), 0);
            points = Math.round((total / used.length) * 100) / 100;
          }
          placements.push({ competitorId: r.competitorId, place: assignedPlace, tied: span > 1, points });
        });
        curPlace += span;
      }
      const completionPts = ev.status === "completed" ? COMPLETION_POINTS : 0;
      noResults.forEach(r => placements.push({
        competitorId: r.competitorId,
        place: null,
        tied: false,
        // DQ'd competitors get 0 points (not even participation) — they're disqualified for cause.
        points: r.dq ? 0 : completionPts,
        dq: !!r.dq
      }));
    }
    return placements;
  }

  // ---------- Standards ----------
  /**
   * Returns "gold" | "silver" | "bronze" | null based on whether `value` beats
   * the standard's targets. For timed events, smaller is better; for
   * distance/weight, larger is better.
   */
  function tierForResult(value, std, type) {
    if (value == null || std == null) return null;
    const better = (a, b) => type === "timed" ? a <= b : a >= b;
    if (std.gold   != null && better(value, std.gold))   return "gold";
    if (std.silver != null && better(value, std.silver)) return "silver";
    if (std.bronze != null && better(value, std.bronze)) return "bronze";
    return null;
  }

  // ---------- Records / PBs ----------
  function isNewRecord(currentValue, existingRecord, type) {
    if (currentValue == null) return false;
    if (!existingRecord) return true;
    return type === "timed" ? currentValue < existingRecord.value
                            : currentValue > existingRecord.value;
  }
  function didBeatPB(competitor, ev, personalBests) {
    if (!competitor) return false;
    const best = bestOf(competitor.attempts, ev.type);
    if (best == null) return false;
    const pb = (personalBests || []).find(p =>
      (p.name || "").trim().toLowerCase() === (competitor.name || "").trim().toLowerCase() &&
      (p.title || "").toLowerCase() === (ev.title || "").toLowerCase());
    if (!pb) return false;
    return ev.type === "timed" ? best < pb.value : best > pb.value;
  }

  // ---------- Formatting ----------
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function fmtTimer(ms) {
    if (ms == null || isNaN(ms)) return "--";
    const sign = ms < 0 ? "-" : ""; ms = Math.abs(ms);
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${sign}${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }

  return {
    PLACE_POINTS, COMPLETION_POINTS,
    bestOf, bestOfCompetitor, isWindAided,
    compareResults, pointsForPlace,
    parseBand, ageInBand, bandForAge, divisionForAge, computeAge,
    computePlacements, tierForResult, isNewRecord, didBeatPB,
    ordinal, fmtTimer
  };
}));
