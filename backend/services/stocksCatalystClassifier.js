// backend/services/stocksCatalystClassifier.js
//
// P2.5 (2026-09-09) — deterministic structured catalyst classifier.
//
// Input:  { ticker, source, sourceId, eventDate, headline, body?, url? }
// Output: {
//   category:            one of CATALYST_CATEGORIES,
//   categoryConfidence:  0..1 (deterministic — keyword score),
//   materialityScore:    0..100 (how meaningful for the company),
//   evidence:            first 200 chars of matched text,
//   extras:              structured extractions where possible,
//   classifiedBy:        "deterministic-keyword-v1",
// }
//
// Rules the classifier enforces:
//   • Every event returns a category. Ambiguous items go to
//     OTHER_MATERIAL if any keyword hits at all, or NEWS_NOISE if the
//     item matches known low-value patterns (analyst-note, PR-boiler,
//     social-media excitement, recycled headline, generic product PR).
//   • Materiality scoring is CONSERVATIVE. A generic product
//     announcement never exceeds ~25. An earnings-guidance change
//     with a specific number can reach 80-100.
//   • The classifier is deterministic — same input always same output.
//     An LLM enrichment pass (future) may overwrite categoryConfidence
//     and materialityScore for the same row (idempotent by sourceId).
//   • The classifier ONLY returns structured evidence — it does not
//     produce a BUY. The pick engine reads catalystEvents from
//     StocksCatalystEvent and applies its own materiality gate before
//     letting a catalyst contribute to OQ.
//
// PUBLIC:
//   classifyCatalystItem(item)  → structured classification
//   persistCatalyst(item)       → upsert into StocksCatalystEvent
//   isMaterial(catalyst)        → boolean gate consumers can use

import StocksCatalystEvent, { CATALYST_CATEGORIES } from "../models/StocksCatalystEvent.js";
import crypto from "crypto";

// Keyword rulebook. Each rule = { pattern (RegExp OR string), category,
// baseMateriality, weight }. Weight increases the category-confidence.
// Rules are evaluated in order — first strong match wins the category,
// but ALL matching rules contribute their materiality bumps.
const RULES = [
  // Earnings & guidance
  { patterns: [/rais(e|es|ed|ing) (its )?(full[- ]?year|fy|annual|q[1-4]|quarterly) guidance/i,
               /raise(s|d)? (fy|full[- ]?year|q[1-4]) (eps|revenue|earnings) (guidance|outlook)/i,
               /guidance (increase|raise|beat)/i,
               /company (beat|beats) (analyst|street) (estimates|expectations)/i],
    category: "EARNINGS_GUIDANCE", baseMateriality: 70, weight: 3 },
  { patterns: [/lower(s|ed)? (fy|full[- ]?year|q[1-4]) (guidance|outlook)/i,
               /cut(s|ting)? guidance/i, /issues profit warning/i,
               /warns on (earnings|q[1-4])/i],
    category: "EARNINGS_GUIDANCE", baseMateriality: 70, weight: 3 },
  { patterns: [/reports? (q[1-4]|fy) (earnings|results)/i,
               /q[1-4] (revenue|earnings) (beat|miss)/i],
    category: "EARNINGS_GUIDANCE", baseMateriality: 50, weight: 2 },

  // Major contracts
  { patterns: [/awarded (a )?(\$[\d.]+(?:m|mm|bn|billion|million))? ?contract/i,
               /signs (a )?(multi[- ]?year|long[- ]?term)? ?(agreement|contract) with/i,
               /wins (a )?\$[\d.]+ ?(m|mm|bn|billion|million) (contract|deal)/i],
    category: "MAJOR_CONTRACT", baseMateriality: 50, weight: 2 },

  // Regulatory approval
  { patterns: [/(fda|ema|mhra|health canada) (approves|approval|clearance)/i,
               /pdufa (date|decision)/i, /granted (breakthrough|orphan drug) designation/i,
               /(nda|bla|510\(k\)) (approval|filing)/i],
    category: "REGULATORY_APPROVAL", baseMateriality: 75, weight: 3 },

  // Product commercialization
  { patterns: [/commercial(izes|ization|ly available) launch/i,
               /general availability of/i,
               /begins (mass|volume) production/i,
               /(first|initial) revenue from/i],
    category: "PRODUCT_COMMERCIALIZATION", baseMateriality: 45, weight: 2 },

  // M&A / special situations
  { patterns: [/(agrees|announces) to acquire/i, /to be acquired by/i,
               /merger agreement/i, /tender offer/i, /take[- ]?private/i,
               /spin[- ]?off/i, /divestiture/i],
    category: "MA_SPECIAL_SITUATION", baseMateriality: 80, weight: 3 },

  // Capital return
  { patterns: [/announces? (a )?\$?[\d.]* ?(billion|million|bn|mm|m)? share buyback/i,
               /increases? (its )?dividend/i, /special dividend/i,
               /accelerates? share repurchase/i, /raises? dividend/i],
    category: "CAPITAL_RETURN", baseMateriality: 40, weight: 2 },

  // Margin inflection
  { patterns: [/gross margin expands to/i, /operating margin improves? \d/i,
               /record (gross|operating|ebitda) margin/i],
    category: "MATERIAL_MARGIN_INFLECTION", baseMateriality: 55, weight: 2 },

  // Industry demand inflection
  { patterns: [/industry (demand|shipments) (surge|inflection|rebound)/i,
               /order backlog grew/i,
               /book-to-bill (above|exceeds) \d/i],
    category: "INDUSTRY_DEMAND_INFLECTION", baseMateriality: 55, weight: 2 },

  // Noise patterns — these DAMPEN materiality regardless of category
  // hit and can force NEWS_NOISE if nothing else applies.
  { patterns: [/analyst raises? price target/i,
               /(reddit|twitter|x\.com|social media) (buzz|chatter)/i,
               /(stock|shares) (jumps|surges|soars) after/i,
               /options traders bet on/i,
               /article \(free\)|reddit thread|weekend read/i],
    category: "NEWS_NOISE", baseMateriality: 5, weight: 2 },
];

// Small structured-extraction helpers — best-effort. Return { extras }.
function extractExtras(headline, body) {
  const text = `${headline || ""} ${body || ""}`;
  const extras = {};
  const contractSize = text.match(/\$([\d.]+)\s*(bn|billion|mm|m|million)/i);
  if (contractSize) extras.contractSize = { value: Number(contractSize[1]), unit: contractSize[2].toLowerCase() };
  const guidance = text.match(/(?:eps|revenue) (?:guidance|outlook) (?:of|to) \$?([\d.]+)/i);
  if (guidance) extras.guidanceValue = Number(guidance[1]);
  const acquirer = text.match(/acquired by ([A-Z][A-Za-z0-9&.\- ]+?)(?:$|[,.])/i);
  if (acquirer) extras.acquirer = acquirer[1].trim();
  return extras;
}

// PUBLIC
export function classifyCatalystItem(item = {}) {
  const headline = String(item.headline || "");
  const body = String(item.body || "");
  const text = `${headline}\n${body}`.trim();
  if (!text) {
    return {
      category: "OTHER_MATERIAL",
      categoryConfidence: 0,
      materialityScore: 0,
      evidence: "",
      extras: {},
      classifiedBy: "deterministic-keyword-v1",
    };
  }
  // Score each candidate category from the matching rules.
  const scores = new Map(); // category → { weight, base, matchedText, ruleHits }
  for (const rule of RULES) {
    for (const p of rule.patterns) {
      const m = typeof p === "string" ? text.toLowerCase().includes(p.toLowerCase()) ? [p] : null
                                       : text.match(p);
      if (!m) continue;
      const s = scores.get(rule.category) || { weight: 0, base: 0, matchedText: null, ruleHits: 0 };
      s.weight += rule.weight;
      s.base = Math.max(s.base, rule.baseMateriality);
      if (!s.matchedText) s.matchedText = m[0] || m.input?.slice(m.index || 0, (m.index || 0) + 120);
      s.ruleHits++;
      scores.set(rule.category, s);
    }
  }
  if (scores.size === 0) {
    return {
      category: "OTHER_MATERIAL",
      categoryConfidence: 0.2,
      materialityScore: 10,
      evidence: text.slice(0, 200),
      extras: extractExtras(headline, body),
      classifiedBy: "deterministic-keyword-v1",
    };
  }
  // Pick the highest-weight non-NEWS_NOISE category. If NEWS_NOISE
  // fires alongside a real category, materiality is dampened but the
  // category stays with the substantive one. If only NEWS_NOISE
  // fires, that wins.
  let best = null, bestWeight = -Infinity;
  for (const [cat, s] of scores.entries()) {
    if (cat === "NEWS_NOISE") continue;
    if (s.weight > bestWeight) { best = cat; bestWeight = s.weight; }
  }
  if (!best) {
    // Only NEWS_NOISE matched.
    const noise = scores.get("NEWS_NOISE");
    return {
      category: "NEWS_NOISE",
      categoryConfidence: Math.min(1, noise.weight / 5),
      materialityScore: Math.min(15, noise.base),
      evidence: noise.matchedText?.slice(0, 200) || text.slice(0, 200),
      extras: extractExtras(headline, body),
      classifiedBy: "deterministic-keyword-v1",
    };
  }
  const s = scores.get(best);
  const noiseDamp = scores.has("NEWS_NOISE") ? 0.7 : 1.0;
  const confidence = Math.min(1, s.weight / 5);
  const material = Math.round(Math.max(0, Math.min(100, s.base * noiseDamp * (0.6 + 0.4 * confidence))));
  return {
    category: best,
    categoryConfidence: Number(confidence.toFixed(2)),
    materialityScore: material,
    evidence: s.matchedText?.slice(0, 200) || text.slice(0, 200),
    extras: extractExtras(headline, body),
    classifiedBy: "deterministic-keyword-v1",
  };
}

// PUBLIC — a callable that decides whether a classified catalyst is
// material enough to CONTRIBUTE to OQ. The threshold is intentionally
// conservative: news-noise never contributes; only ≥30 material score.
const DEFAULT_MATERIALITY_GATE = Number(process.env.STOCKS_CATALYST_MATERIALITY_MIN || 30);
export function isMaterial(catalyst, gate = DEFAULT_MATERIALITY_GATE) {
  if (!catalyst) return false;
  if (catalyst.category === "NEWS_NOISE") return false;
  return Number(catalyst.materialityScore) >= gate;
}

// PUBLIC — persist a classified item (idempotent by sourceId).
export async function persistCatalyst(item, classified = null) {
  const c = classified || classifyCatalystItem(item);
  const sourceId = item.sourceId || crypto.createHash("sha1").update(`${item.source}::${item.headline || ""}`).digest("hex");
  const doc = {
    ticker: String(item.ticker || "").toUpperCase(),
    source: item.source || "unknown",
    sourceId,
    eventDate: String(item.eventDate || new Date().toISOString().slice(0, 10)),
    sourceDate: item.sourceDate || null,
    headline: item.headline || null,
    url: item.url || null,
    category: c.category,
    categoryConfidence: c.categoryConfidence,
    materialityScore: c.materialityScore,
    evidence: c.evidence,
    extras: c.extras,
    classifiedBy: c.classifiedBy,
    classifiedAt: new Date(),
    dedupeKey: item.dedupeKey || null,
  };
  try {
    await StocksCatalystEvent.updateOne(
      { ticker: doc.ticker, source: doc.source, sourceId: doc.sourceId },
      { $set: doc },
      { upsert: true },
    );
  } catch (e) {
    console.warn(`[catalyst-classifier] persist failed for ${item.ticker}:`, e?.message);
  }
  return doc;
}
