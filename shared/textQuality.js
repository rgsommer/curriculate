// shared/textQuality.js
//
// Pure-JS answer/speech quality scoring, shared by the student-app live meter
// (SpeechQualityMeter) and the backend session reports. No React, no DOM.
//
// Score (0-100) rises with sustained length + vocabulary variety and FALLS
// with filler-word density (um/uh/like/you know/…) and heavy repetition.
// Because dictation writes recognized speech into the same text box, this one
// text-based score covers both typed and spoken input.

// "you see" / "kind of" / "sort of" removed — they're frequently legitimate in
// written sentences ("an example is when you see steam…", "a kind of energy"),
// which produced false positives (tester). Keep only clear vocalized hedges.
const FILLER_PHRASES = ["you know", "i mean"];
// Only UNAMBIGUOUS vocalized fillers — words like "so", "like", "just",
// "really", "actually", "well", "right" are frequently legitimate (transitions,
// comparisons, emphasis) and were producing false positives (tester: "thinks
// transition words like 'so' and 'like' are filler words, when they're not").
const FILLER_WORDS = new Set([
  "um", "uh", "umm", "uhh", "er", "erm", "ah", "ahh", "hmm", "mhm",
  "uhm", "eh", "mm", "mmm",
]);

/**
 * @param {string} rawText
 * @returns {{score:number, words:number, fillers:number, fillerExamples:string[], label:string, color:string}}
 */
export function computeTextQuality(rawText) {
  const text = String(rawText || "").toLowerCase().trim();
  if (!text) {
    return { score: 0, words: 0, fillers: 0, fillerExamples: [], label: "Start writing or speaking…", color: "#94a3b8" };
  }

  let fillers = 0;
  const fillerExamples = [];
  let working = text;
  for (const phrase of FILLER_PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`, "g");
    const m = working.match(re);
    if (m) {
      fillers += m.length;
      fillerExamples.push(phrase);
      working = working.replace(re, " ");
    }
  }

  const tokens = working.split(/\s+/).map((w) => w.replace(/[^a-z']/g, "")).filter(Boolean);
  const n = tokens.length;
  if (n === 0) {
    return { score: 0, words: 0, fillers, fillerExamples, label: "Start writing or speaking…", color: "#94a3b8" };
  }

  const uniqueWords = new Set(tokens);
  for (const t of tokens) {
    if (FILLER_WORDS.has(t)) {
      fillers += 1;
      if (fillerExamples.length < 4 && !fillerExamples.includes(t)) fillerExamples.push(t);
    }
  }

  const lengthComponent = Math.min(1, n / 50) * 60;
  const uniqueRatio = uniqueWords.size / n;
  const varietyComponent = Math.max(0, Math.min(1, (uniqueRatio - 0.3) / 0.5)) * 20;
  const baseline = 20;
  const fillerDensity = fillers / n;
  const fillerPenalty = Math.min(45, fillerDensity * 250);

  const score = Math.max(0, Math.min(100, Math.round(lengthComponent + varietyComponent + baseline - fillerPenalty)));

  let label, color;
  if (score >= 80) { label = "Excellent — clear & substantive"; color = "#16a34a"; }
  else if (score >= 60) { label = "Strong"; color = "#22c55e"; }
  else if (score >= 40) { label = "Good — keep going"; color = "#eab308"; }
  else if (score >= 20) { label = "Warming up"; color = "#f97316"; }
  else { label = "Just starting"; color = "#ef4444"; }

  if (fillers > 0 && score >= 20) {
    label = `${label} · ${fillers} filler${fillers === 1 ? "" : "s"}`;
  }

  return { score, words: n, fillers, fillerExamples, label, color };
}

/**
 * Short one-word grade for compact report cells.
 */
export function qualityGrade(score) {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Strong";
  if (score >= 40) return "Good";
  if (score >= 20) return "Developing";
  return "Minimal";
}

export default computeTextQuality;
