// backend/services/briefingAudit.js
//
// Phase 1 of the Stocks Advisor rewrite (spec 2026-08-13 §20):
// self-audit gate that runs immediately before a briefing is emailed.
// If ANY check fails, the audit returns { ok: false, blockers: [...] }
// and the send is suppressed. Better to skip a briefing than to send
// one with a fabricated price or a contradictory instruction.
//
// The audit is deliberately paranoid — every check that can produce
// a false-positive rejection here has been chosen to prefer "block
// and log" over "silently ship broken data." The user will see
// suppressed sends in the diagnostic endpoint; the send resumes on
// the next tick once the underlying issue is fixed.
//
// Checks (each returns {ok, reason?, detail?}):
//   1. every accepted rec has a verified market-data price
//   2. every rec's price matches the verified price (drift check)
//   3. no rec cites a stop / target of $0
//   4. no BUY rec for a ticker in §5 BLOCKED
//   5. no SELL/EXIT/TRIM rec for a ticker not currently held
//   6. no ticker in DO TODAY that's also in TRAIL STOP REVIEW
//   7. positions currency-consistent with rec (USD rec vs CAD position mismatch)
//   8. briefing has §2 FORBIDDEN present (even if "None.")
//   9. no fabricated §1 mandate BUY without a corresponding
//      MANDATE_DEFAULT_TICKERS entry (implies price wasn't fetched)
//
// Returns:
//   { ok: true } — send is fine
//   { ok: false, blockers: [{check, reason, detail}], warnings: [...] }

import { verifyRecPrice, getVerifiedPrice } from "./marketDataIntegrity.js";
import { computeCanonicalPortfolio, getCanonicalPosition, getCanonicalSleeve } from "./portfolioCalcEngine.js";

function baseOf(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

// Run every check. Returns { ok, blockers, warnings, ranAt, elapsedMs }.
// `positions` = live portfolio positions. `acceptedRecs` = post-validator
// recs the briefing intends to persist. `rejectedRecs` = for the §5
// BLOCKED cross-check. `md` = final markdown for text-level scans.
// `profile` = optional; when provided, runs the Phase 3+4 canonical
// portfolio checks (impossible-stop detector, percentage reconciliation,
// cross-section consistency).
export async function auditBriefingBeforeSend({ email, md, acceptedRecs = [], rejectedRecs = [], positions = [], profile = null }) {
  const t0 = Date.now();
  const blockers = [];
  const warnings = [];
  const heldBases = new Set(
    (positions || [])
      .filter(p => (p?.qty || 0) > 0)
      .map(p => baseOf(p.ticker))
      .filter(Boolean)
  );

  // Compute canonical portfolio once — every downstream check reads
  // from the same object so no section can invent its own number.
  // Prefer the full profile (has accounts + fx + sleeve targets); fall
  // back to a minimal shape from positions if profile isn't provided.
  const canonicalProfile = profile || { positions, accounts: [], fxUsdCad: 1.37 };
  let canonical = null;
  try { canonical = computeCanonicalPortfolio(canonicalProfile); }
  catch (e) { console.warn("[audit] canonical portfolio compute failed:", e?.message); }

  // ─── 1 & 2: verify every accepted rec's entryPrice against the
  // integrity layer. This is the "no fabricated prices" gate.
  //
  // Exit-side recs (SELL / EXIT / TRIM) are exempt from the drift
  // check: entryPrice on an exit is a reference number, not an
  // execution price — the operator takes the market, whatever it is.
  // Applying the drift gate to exits was blocking legitimate SELL
  // mandates when the reference price captured at rec-time drifted
  // past 3% by rec-render-time. Contamination detection (fabricated
  // ticker prices) is still handled by verifyRecPrice's market-data-*
  // rejection reasons, which we keep enforcing for every action —
  // only the drift-specific rejection is downgraded for exits.
  const EXIT_ACTIONS = new Set(["SELL", "EXIT", "TRIM"]);
  for (const rec of (acceptedRecs || [])) {
    if (!rec?.ticker) continue;
    let verified;
    try { verified = await verifyRecPrice(rec); }
    catch (e) {
      blockers.push({
        check: "rec-price-verify-crashed",
        reason: `verification threw for ${rec.ticker}`,
        detail: e?.message || String(e),
      });
      continue;
    }
    if (!verified.ok) {
      const isExit = EXIT_ACTIONS.has(String(rec.action || "").toUpperCase());
      const isDriftOnly = verified.rejectionReason === "rec-price-drift";
      if (isExit && isDriftOnly) {
        // Downgrade to a warning — the exit is still valid; the price
        // reference just moved. Do not block the whole briefing.
        warnings.push({
          check: "rec-price-drift-on-exit",
          ticker: rec.ticker,
          detail: `${rec.action} ${rec.ticker}: ${verified.detail} (downgraded — exit-side rec, market takes fill)`,
        });
        continue;
      }
      blockers.push({
        check: "rec-price-invalid",
        reason: `${rec.action || "?"} ${rec.ticker}: ${verified.rejectionReason}`,
        detail: verified.detail || "",
      });
      continue;
    }
    for (const w of (verified.warnings || [])) {
      warnings.push({ check: "rec-price-warn", ticker: rec.ticker, detail: w });
    }
  }

  // ─── 3: $0 stops or targets. Bad data that keeps escaping — user
  // called it out Aug 13 for XEQT. Belt-and-braces even though the
  // ingestion path now guards.
  for (const rec of (acceptedRecs || [])) {
    if (rec?.stopPrice != null && !(rec.stopPrice > 0)) {
      blockers.push({
        check: "zero-stop",
        reason: `${rec.action || "?"} ${rec.ticker} has stopPrice=${rec.stopPrice}`,
        detail: "Stop must be > 0. Bad data.",
      });
    }
    if (rec?.targetPrice != null && !(rec.targetPrice > 0)) {
      blockers.push({
        check: "zero-target",
        reason: `${rec.action || "?"} ${rec.ticker} has targetPrice=${rec.targetPrice}`,
        detail: "Target must be > 0.",
      });
    }
  }

  // ─── 4: BUY rec for a blocked ticker. rewriteRecsBlock should
  // have already handled this but validate the invariant.
  const blockedBases = new Set(
    (rejectedRecs || []).map(x => baseOf(x?.rec?.ticker)).filter(Boolean)
  );
  for (const rec of (acceptedRecs || [])) {
    if (rec?.action === "BUY" && blockedBases.has(baseOf(rec.ticker))) {
      blockers.push({
        check: "buy-of-blocked-ticker",
        reason: `BUY ${rec.ticker} — validator BLOCKED this ticker in the same batch`,
        detail: "Mixed signals; accepted rec must not survive when a sibling was rejected.",
      });
    }
  }

  // ─── 5: SELL/EXIT/TRIM on a ticker not held. The phantom-ticker
  // guard already strips these from markdown; audit ensures no
  // structured rec slipped through.
  for (const rec of (acceptedRecs || [])) {
    if (!rec?.action) continue;
    if (rec.action === "SELL" || rec.action === "EXIT" || rec.action === "TRIM") {
      if (!heldBases.has(baseOf(rec.ticker))) {
        blockers.push({
          check: "phantom-sell",
          reason: `${rec.action} ${rec.ticker} but ticker is not held`,
          detail: `Held bases: ${[...heldBases].join(", ") || "(none)"}`,
        });
      }
    }
  }

  // ─── 5b: same-ticker self-swap. A batch that contains both
  // SELL/EXIT/TRIM X AND BUY/ADD X (same base ticker) is nonsense —
  // it's telling the operator to sell shares and buy them right back.
  // This produced the "SELL 21 sh XEQT.TO … BUY 21 sh XEQT.TO"
  // pattern users flagged in the CORE-trail-review IF-EXIT REDEPLOY
  // block. The paired-REDEPLOY generator now filters its destination
  // list, but the audit is a defense in depth.
  const sellBases = new Set();
  const buyBases = new Set();
  for (const rec of (acceptedRecs || [])) {
    if (!rec?.action || !rec?.ticker) continue;
    const b = baseOf(rec.ticker);
    if (["SELL", "EXIT", "TRIM"].includes(rec.action)) sellBases.add(b);
    if (["BUY", "ADD"].includes(rec.action)) buyBases.add(b);
  }
  for (const b of sellBases) {
    if (buyBases.has(b)) {
      blockers.push({
        check: "same-ticker-self-swap",
        reason: `Batch contains both SELL/TRIM/EXIT and BUY/ADD of ${b} — sell-then-rebuy of the same security is nonsense`,
        detail: "Either the sell is wrong or the buy is wrong. Rebuys of the same security within one batch should never happen; if the operator really wants to rebalance a holding, express it as a single ADD/TRIM with the net delta, not a sell+buy pair.",
      });
    }
  }

  // ─── 6: DO TODAY vs TRAIL STOP REVIEW contradiction. Text-level
  // scan of the final md for tickers that appear in both.
  if (md && typeof md === "string") {
    const doTodayBlock = md.match(/##\s*🎯?\s*DO TODAY[\s\S]{0,4000}?(?=\n##\s|\n$)/i);
    const trailReviewBlock = md.match(/\*\*TRAIL STOP REVIEW\*\*[\s\S]{0,2000}?(?=\n\n|\n\d+\.)/gi);
    if (doTodayBlock && trailReviewBlock) {
      const doTickers = new Set(
        [...(doTodayBlock[0] || "").matchAll(/\b(?:BUY|SELL|EXIT|TRIM)\s+\d+\s+([A-Z]{2,5})(?:\.(?:TO|V|NE))?\b/g)]
          .map(m => m[1])
      );
      for (const tr of trailReviewBlock) {
        const m = tr.match(/\*\*TRAIL STOP REVIEW\*\*\s*—\s*\*\*([A-Z]{2,5})/);
        const trTicker = m?.[1];
        if (trTicker && doTickers.has(trTicker)) {
          const sample = [...doTickers].find(t => t === trTicker);
          blockers.push({
            check: "trail-review-vs-do-today",
            reason: `${trTicker} appears in both DO TODAY (with a SELL/EXIT ticket) AND TRAIL STOP REVIEW`,
            detail: `Same-ticker contradiction: REVIEW says "decide today", DO TODAY says "sell". Pick one.`,
          });
        }
      }
    }
  }

  // ─── 7: rec currency vs held-position currency mismatch. If the
  // user holds AAPL as USD and a rec proposes SELL AAPL @ some CAD
  // price, that's a currency-confusion bug.
  const heldByBase = new Map();
  for (const p of (positions || [])) {
    const b = baseOf(p.ticker);
    if (b) heldByBase.set(b, p);
  }
  for (const rec of (acceptedRecs || [])) {
    if (!rec?.ticker || !rec?.entryCurrency) continue;
    const held = heldByBase.get(baseOf(rec.ticker));
    if (held && held.ccy && held.ccy !== rec.entryCurrency) {
      warnings.push({
        check: "currency-mismatch-held",
        ticker: rec.ticker,
        detail: `Rec cites ${rec.entryCurrency} but position held as ${held.ccy}. Verify — possible USD/CAD confusion.`,
      });
    }
  }

  // ─── 8: §2 FORBIDDEN present. Fixed structurally in prefix
  // renderer but validate invariant.
  if (md && typeof md === "string") {
    if (!/##\s*2\.\s*🛑?\s*FORBIDDEN TODAY/i.test(md)) {
      warnings.push({
        check: "section-2-missing",
        detail: "§2 FORBIDDEN TODAY not found. Prefix renderer should always emit it, even 'None.'",
      });
    }
  }

  // ─── 8-ND (audit fix #229): MANDATORY "None" contradicting a
  // populated DO TODAY / order-ticket section. The rendered briefing
  // said "MANDATORY ACTIONS: None. Portfolio is inside all hard rules
  // today." then two sections later listed a SELL 234 DJT ticket.
  // If DO TODAY has any BUY/SELL/EXIT/TRIM line, MANDATORY cannot say
  // "None" — the accepted rec IS a mandatory action for the operator.
  if (md && typeof md === "string") {
    const mandatoryNone = /##\s*1\.[^\n]*MANDATORY[\s\S]{0,300}?None\.\s*Portfolio is inside all hard rules today/i.test(md);
    if (mandatoryNone) {
      const doTodayBlock = md.match(/DO TODAY[^\n]*[\s\S]{0,2000}?(?=\n##\s|\n📎|\n$)/i);
      const hasOrderTicket = doTodayBlock && /\b(?:BUY|SELL|EXIT|TRIM|ADD)\s+\d+\s+(?:sh\s+)?[A-Z]{1,5}/.test(doTodayBlock[0]);
      if (hasOrderTicket) {
        blockers.push({
          check: "mandatory-none-with-do-today-tickets",
          reason: "MANDATORY ACTIONS says 'None' but DO TODAY contains at least one BUY/SELL/EXIT/TRIM order ticket",
          detail: "The accepted rec ticket IS a mandatory action for the operator; MANDATORY must reflect it, not declare 'None'. Fix: either drop the ticket (if not truly mandatory) or update the MANDATORY message to reference the accepted-rec ticket(s) below.",
        });
      }
    }
  }

  // ─── 8a (audit fix #227.1): future-dated "open violation" is
  // temporally impossible. A briefing dated today can't say a
  // violation on some future date is "still open" — that date
  // hasn't happened yet.
  if (md && typeof md === "string") {
    const today = new Date();
    // Match "violation <Month> <D>[<suffix>]" or "violation on <date>"
    // followed within ~80 chars by "still open" / "still active" /
    // "open" / "unresolved".
    const violationRe = /\bviolation[^\n\.]{0,80}?\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)[^\n\.]{0,80}?\b(still\s+open|still\s+active|open|unresolved)/gi;
    let vm;
    while ((vm = violationRe.exec(md)) !== null) {
      const dateStr = vm[1];
      const parsed = new Date(`${dateStr} ${today.getFullYear()}`);
      if (!isNaN(parsed.getTime())) {
        // If the parsed date is > 3 days in the future (some tolerance
        // for time-zone edge cases), that's the temporal-consistency
        // failure.
        const daysAhead = (parsed - today) / (24 * 60 * 60 * 1000);
        if (daysAhead > 3) {
          blockers.push({
            check: "future-dated-open-violation",
            reason: `Briefing states a violation on ${dateStr} is "still open" but that date is ${Math.round(daysAhead)}d in the future`,
            detail: "A violation cannot already be 'still open' on a date that hasn't arrived yet. Almost certainly a date-off-by-one-year or bad stringify from the alerts pipeline. Fix upstream before emitting.",
          });
          break;
        }
      }
    }
  }

  // ─── 8c (audit fix #227.2): cross-section price drift.
  // If the same ticker appears with two different current prices in
  // different sections of the briefing (e.g. DJT @ $8.63 in §1 vs
  // $8.45 in §A2), that's the "one canonical current price per
  // ticker" rule violated.
  //
  // Proximity: the $-price must be in the SAME sentence as the
  // ticker mention (bounded by ".", "\n", "|", "·"). A 200-char
  // free-form window was too generous and produced false positives
  // when two tickers landed in the same paragraph — e.g. "AAPL
  // trades at $215.31; DJT should follow." would attribute $215.31
  // to DJT even though it belonged to AAPL.
  //
  // Tolerance: 2% for a real disagreement between sections. But
  // reject any single observation whose implied price differs from
  // the ticker's fresh live/canonical price by more than 25% — that
  // is not intraday drift, it is cross-ticker contamination and
  // should not survive to the drift comparison at all.
  if (md && typeof md === "string" && canonical) {
    // Fresh live-price map for canonical positions — used to reject
    // observations that are obviously another ticker's price.
    const livePriceByBase = new Map();
    for (const p of canonical.positions || []) {
      const lp = Number(p.price);
      if (Number.isFinite(lp) && lp > 0) livePriceByBase.set(p.base, lp);
    }
    const priceByTicker = new Map(); // base → array of {price, ccy}
    const heldBaseSet = new Set(canonical.positions.map(p => p.base));
    // Sentence boundary — first ".", newline, table separator, or
    // bullet dot after the ticker occurrence, capped at 120 chars.
    const SENTENCE_STOPS = /[.\n|·]/;
    // Words that mark a $-price as something other than "current
    // price" — stops, targets, PTs, cost basis, trail levels, etc.
    // A "current-price disagreement" check must ignore these or it
    // flags legitimate designs (e.g. RY current $282 with a $270
    // stop) as drift when they are not.
    const NON_PRICE_CONTEXT = /\b(stop|target|PT|price target|trail|trailing|cost basis|entry|cost|hwm|high water mark|drawdown from|prior close|yesterday|book|hard\s*stop|resistance|support)\b/i;
    for (const base of heldBaseSet) {
      const livePrice = livePriceByBase.get(base) || null;
      const tickerRe = new RegExp(`\\b${base}(?:\\.[A-Z]{1,3})?\\b`, "g");
      let m;
      while ((m = tickerRe.exec(md)) !== null) {
        const raw = md.slice(m.index, m.index + 120);
        const stopIdx = raw.slice(base.length).search(SENTENCE_STOPS);
        const window = stopIdx > 0 ? raw.slice(0, base.length + stopIdx) : raw;
        // For every $-price in the window, inspect the ~20 chars
        // preceding it. If those chars name a non-price context
        // (stop / target / PT / entry / trail), skip it — that
        // number is not a claim about the current price.
        const priceGlobal = /\$(\d+(?:\.\d{1,2})?)\s*(USD|CAD)?/g;
        let pm;
        while ((pm = priceGlobal.exec(window)) !== null) {
          const preCtx = window.slice(Math.max(0, pm.index - 22), pm.index);
          if (NON_PRICE_CONTEXT.test(preCtx)) continue;
          const px = Number(pm[1]);
          const ccy = pm[2] || null;
          if (!Number.isFinite(px) || px <= 0) continue;
          // Reject observations >25% off live — cross-ticker contamination,
          // caught properly by the PT-contamination checks upstream.
          if (livePrice && Math.abs(px - livePrice) / livePrice > 0.25) continue;
          if (!priceByTicker.has(base)) priceByTicker.set(base, []);
          priceByTicker.get(base).push({ price: px, ccy });
        }
      }
    }
    for (const [base, observations] of priceByTicker) {
      if (observations.length < 2) continue;
      // Compare min vs max; if drift > 2% they disagree.
      const prices = observations.map(o => o.price);
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const drift = ((maxP - minP) / minP) * 100;
      if (drift > 2.0) {
        blockers.push({
          check: "cross-section-price-drift",
          reason: `${base} referenced at multiple prices across sections: min $${minP.toFixed(2)}, max $${maxP.toFixed(2)} (${drift.toFixed(1)}% drift)`,
          detail: "One canonical current price per ticker. If §1 cites one number and §A2 cites another for the same instrument, at least one is wrong or stale. Refetch and re-render both sections from the same source.",
        });
      }
    }
  }

  // ─── 8d (audit fix #227.3): behavioural coaching phrases require
  // adequate sample size. AI produced "PUSH HARDER on high-conviction
  // recs" based on a small closed-rec sample where the difference
  // between followed and skipped was well within noise. Strong
  // behavioural imperatives shouldn't ride on a 7d hit rate.
  if (md && typeof md === "string") {
    const strongPhrases = /\b(PUSH HARDER|LEAN IN|TRUST THE (SIGNAL|SYSTEM|MODEL)|ACT (MORE )?AGGRESSIVELY|SIZE UP|BE (?:MORE )?DECISIVE)\b/i;
    if (strongPhrases.test(md)) {
      // Try to find the sample size that supports the claim. Look
      // for "N closed" / "N recs" / "N samples" nearby. If we can't
      // find one that's >= 50, block.
      const nMatches = [...md.matchAll(/(\d+)\s+(?:closed|recs|samples|trades)\b/gi)].map(x => Number(x[1])).filter(Number.isFinite);
      const maxSample = nMatches.length ? Math.max(...nMatches) : 0;
      if (maxSample < 50) {
        blockers.push({
          check: "strong-language-insufficient-sample",
          reason: `Briefing uses strong behavioural language ("PUSH HARDER" / "LEAN IN" etc.) but the largest cited sample size is ${maxSample} (< 50)`,
          detail: "Behavioural imperatives require sample sizes and confidence intervals that support them. Anything under ~50 closed observations is noise. Strip the strong language or wait for enough data.",
        });
      }
    }
  }

  // ─── 8e (audit fix #228.1): fundamental-data contamination gate.
  // The AI has been observed inserting current stock price into
  // fundamental fields:
  //   • BNS "reported $118.85B Q2 profit" (real: $2.6B — $118.85 is
  //     the stock price)
  //   • RY "distributed C$282.04 per share" (real: $1.76/qtr — $282
  //     is the stock price)
  //   • TD "annual dividend $160.50 per share" (real: ~$4.30/yr)
  //
  // These are LOAD-BEARING numbers for INCOME sleeve decisions. If
  // the AI can fabricate dividend/coverage/profit numbers from prose,
  // "dividend safe — HOLD" is worthless. Block any briefing where the
  // fundamentals cited look like contamination.
  if (md && typeof md === "string" && canonical) {
    // Build ticker → current price map from canonical (authoritative).
    const priceByBase = new Map();
    for (const p of canonical.positions) {
      if (p.base && Number.isFinite(p.price)) {
        priceByBase.set(p.base, p.price);
      }
    }
    const contaminationBlockers = [];
    // Pattern A: "reported $X[B|M] ... profit|income|earnings|revenue"
    // where X looks like a stock price ($10-$500 range) rather than
    // a company-scale dollar figure. Legit big-bank net income for a
    // quarter is billions; if we see "$118.85" without B/M suffix
    // AND the ticker's stock price is close to that number, that's
    // contamination.
    const profitRe = /\b([A-Z]{1,5})\b[^\n]{0,80}?(?:reported|reported|posted|earned|profit|net income|revenue)\s*[^\n]{0,20}?\$?(\d+(?:\.\d+)?)\s*(?:B|billion|M|million)?\b/gi;
    let pmm;
    while ((pmm = profitRe.exec(md)) !== null) {
      const t = String(pmm[1] || "").toUpperCase();
      const num = Number(pmm[2]);
      const currentPrice = priceByBase.get(t);
      const withUnit = /\b(B|billion|M|million)\b/i.test(pmm[0]);
      // If a "profit / revenue / net income" value is quoted WITHOUT
      // a unit suffix AND its magnitude matches this ticker's stock
      // price within 5%, that is almost certainly the price masquerading
      // as a fundamental. A real quarterly profit for a public company
      // is either sub-$1 (EPS) or in the billions — never a per-share
      // stock-price-magnitude number without a unit.
      if (!withUnit && Number.isFinite(currentPrice) && currentPrice > 5) {
        const drift = Math.abs(num - currentPrice) / currentPrice;
        if (drift < 0.05 && num > 5) {
          contaminationBlockers.push({
            check: "fundamental-value-matches-price",
            reason: `${t}: cited profit/income/revenue value $${num} ≈ current stock price $${currentPrice.toFixed(2)} — almost certainly price data leaked into a fundamentals field`,
            detail: `Excerpt: "${pmm[0].slice(0, 140).replace(/\s+/g, " ")}". Real quarterly profit for a public company is either sub-$1 (EPS) or billions ($B/$M suffix). A raw price-magnitude number without a unit is contamination. Strip the fabricated fundamentals before any INCOME thesis conclusion (dividend safe / payout intact / etc.) can be trusted.`,
          });
        }
      }
    }
    // Pattern B: "distributed $X per share" / "dividend $X per share"
    // where X > 10% of stock price. Real per-share dividends are
    // typically <5% of price; anything > 20% is nonsense.
    const divRe = /\b([A-Z]{1,5})\b[^\n]{0,80}?(?:distributed|dividend|paid|declared)\s*[^\n]{0,20}?\$?(?:C|CA|CAD|USD|US)?\$?\s*(\d+(?:\.\d+)?)\s*(?:per share|\/share|\/sh)/gi;
    let dmm;
    while ((dmm = divRe.exec(md)) !== null) {
      const t = String(dmm[1] || "").toUpperCase();
      const divPerShare = Number(dmm[2]);
      const currentPrice = priceByBase.get(t);
      if (Number.isFinite(currentPrice) && Number.isFinite(divPerShare)
          && currentPrice > 0 && divPerShare / currentPrice > 0.10) {
        contaminationBlockers.push({
          check: "dividend-per-share-exceeds-10pct-of-price",
          reason: `${t}: cited dividend $${divPerShare}/share is ${(divPerShare / currentPrice * 100).toFixed(1)}% of current stock price $${currentPrice.toFixed(2)}`,
          detail: `Excerpt: "${dmm[0].slice(0, 140).replace(/\s+/g, " ")}". Real per-share dividends are almost always <5% of stock price. Anything >10% is almost certainly stock-price data pasted into a dividend field. If the ticker has an actual outsized special dividend, the source pipeline must supply {value, unit, asOf, source} — no free-text fabrications.`,
        });
      }
    }
    // Pattern C: "yield X%" where X > 15%. Real large-cap yields are
    // <10%; >15% is either a REIT-in-distress or fabricated.
    const yieldRe = /\b([A-Z]{1,5})\b[^\n]{0,80}?(?:dividend yield|yield)\s*[^\n]{0,10}?(\d+(?:\.\d+)?)\s*%/gi;
    let ymm;
    while ((ymm = yieldRe.exec(md)) !== null) {
      const t = String(ymm[1] || "").toUpperCase();
      const yld = Number(ymm[2]);
      const currentPrice = priceByBase.get(t);
      if (Number.isFinite(yld) && yld > 15) {
        contaminationBlockers.push({
          check: "implausible-yield-cited",
          reason: `${t}: cited yield ${yld.toFixed(1)}% is implausible for a large-cap dividend name`,
          detail: `Excerpt: "${ymm[0].slice(0, 140).replace(/\s+/g, " ")}". Anything >15% yield is either REIT-in-distress or fabricated. INCOME thesis conclusions cannot ride on this number without a verified source.`,
        });
      }
    }
    // Pattern D (audit fix #229): cross-ticker analyst-PT contamination.
    // A value cited as "PT raised to $XXX" / "target $XXX" in ticker
    // A's paragraph that matches another held ticker B's current
    // price is almost certainly cross-contamination. Real bug:
    // "RY … TD Securities to C$161.36" where $161.36 was TD's price,
    // not RY's target.
    // Method: find sentences containing a target/PT citation, extract
    // ticker context (nearest preceding all-caps token), check the
    // value against every OTHER held ticker's canonical price.
    const ptRe = /\b(?:PT|price target|target)\s+(?:raised to|of|at|to)\s+\$?(?:C|CA|CAD|USD|US)?\$?\s*(\d+(?:\.\d+)?)/gi;
    let pmt;
    while ((pmt = ptRe.exec(md)) !== null) {
      const ptVal = Number(pmt[1]);
      if (!Number.isFinite(ptVal)) continue;
      // Look back up to ~200 chars to find the ticker context.
      const start = Math.max(0, pmt.index - 200);
      const contextBefore = md.slice(start, pmt.index);
      const tickerMatch = [...contextBefore.matchAll(/\b([A-Z]{1,5})\b/g)];
      const contextTicker = tickerMatch.length ? tickerMatch[tickerMatch.length - 1][1] : null;
      if (!contextTicker) continue;
      const contextBase = contextTicker.replace(/\..*$/, "");
      for (const [otherBase, otherPrice] of priceByBase) {
        if (otherBase === contextBase) continue;
        if (!Number.isFinite(otherPrice) || otherPrice <= 0) continue;
        const drift = Math.abs(ptVal - otherPrice) / otherPrice;
        if (drift < 0.005) {   // within 0.5%
          contaminationBlockers.push({
            check: "analyst-target-matches-other-ticker-price",
            reason: `${contextBase}: cited analyst target $${ptVal} matches ${otherBase}'s current price $${otherPrice.toFixed(2)} — cross-ticker field contamination`,
            detail: `Excerpt: "${pmt[0].slice(0, 100).replace(/\s+/g, " ")}". An analyst target for ${contextBase} should NOT equal ${otherBase}'s stock price. This is exactly the field-cross-contamination bug where prices from other holdings get inserted as PT values.`,
          });
          break;
        }
      }
    }
    // Pattern E (audit fix #229): stop level equals cited analyst PT.
    // AI wrote "tighten stop to $216.80" and cited "analyst PT $216.80"
    // in the same paragraph. Stops must come from ATR / support /
    // thesis, never from analyst targets. Two regex orderings — either
    // stop-then-PT or PT-then-stop in the same paragraph.
    const stopThenPtRe = /\b(?:stop|tighten stop|stop-loss)[^\n]{0,40}?\$?(\d+(?:\.\d+)?)[^\n]{0,80}?\b(?:PT|price target|analyst)[^\n]{0,40}?\$?(\d+(?:\.\d+)?)/gi;
    const ptThenStopRe = /\b(?:PT|price target|analyst)[^\n]{0,40}?\$?(\d+(?:\.\d+)?)[^\n]{0,80}?\b(?:stop|tighten stop|stop-loss)[^\n]{0,40}?\$?(\d+(?:\.\d+)?)/gi;
    const checkPair = (re) => {
      let sm;
      while ((sm = re.exec(md)) !== null) {
        const a = Number(sm[1]);
        const b = Number(sm[2]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        if (Math.abs(a - b) / Math.max(a, b) < 0.01) {
          contaminationBlockers.push({
            check: "stop-equals-analyst-target",
            reason: `Cited stop and analyst target both $${a} — stops must come from risk rules (ATR, support, thesis), never from analyst targets`,
            detail: `Excerpt: "${sm[0].slice(0, 160).replace(/\s+/g, " ")}". Analyst PT and stop-loss are unrelated concepts. A PT is where analysts think the stock will go; a stop is where the thesis invalidates. Deriving a stop from a PT means the position exits at the analyst's target, which is the OPPOSITE of a stop.`,
          });
        }
      }
    };
    checkPair(stopThenPtRe);
    checkPair(ptThenStopRe);
    for (const b of contaminationBlockers.slice(0, 8)) blockers.push(b);
  }

  // ─── 8f (audit fix #228.2): stale P/L snapshot.
  // A2 sometimes prints per-holding P/L% computed from a different
  // snapshot than the current price the same section cites. If we
  // can extract "<TICKER> [<SLEEVE> · X% · Y%]" AND we have both
  // canonical current price + cost basis, verify Y ≈ (current−basis)/basis.
  if (md && typeof md === "string" && canonical) {
    const positionByBase = new Map();
    for (const p of canonical.positions) {
      if (p.base) positionByBase.set(p.base, p);
    }
    // Match A2 sleeve tags like "DJT [SPEC · 2.9% · -3.2% · ..."
    // Third %-value in the bracket is P/L% by convention.
    const a2Re = /\b([A-Z]{1,5})\s*\[[A-Z]+\s*·\s*[-\d.]+%\s*·\s*([-\d.]+)%/g;
    let am;
    while ((am = a2Re.exec(md)) !== null) {
      const t = String(am[1]).toUpperCase();
      const statedPnl = Number(am[2]);
      const pos = positionByBase.get(t);
      if (!pos || !Number.isFinite(statedPnl)) continue;
      // Prefer canonical position_return_pct (already computed).
      if (Number.isFinite(pos.position_return_pct)) {
        const drift = Math.abs(statedPnl - pos.position_return_pct);
        if (drift > 2.0) {
          blockers.push({
            check: "stale-pnl-snapshot",
            reason: `${t} A2 shows P/L ${statedPnl.toFixed(1)}%, canonical is ${pos.position_return_pct.toFixed(1)}% (${drift.toFixed(1)}pp drift)`,
            detail: "Per-holding P/L must be recomputed from the same current price + cost basis this briefing renders elsewhere. Mixing snapshots is exactly the alignment bug §24 was designed to eliminate.",
          });
        }
      }
    }
  }

  // ─── 8b (audit fix #224): cross-section contradiction gate.
  // A briefing cannot say MANDATORY ACTION on ticker X in §1 AND
  // "no action / HOLD / mechanical noise" on X in §A2/§0f/Horizon
  // Review. User's XEQT briefing did exactly this and it needs to
  // block, not just log a warning.
  //
  // Method:
  //  1. Extract every ticker mentioned in §1 MANDATORY (any verb —
  //     SELL / EXIT / TRIM / BUY / TRAIL STOP REVIEW).
  //  2. Extract HOLD/no-action mentions of the same ticker anywhere
  //     ELSE in the md.
  //  3. If a ticker appears in both, block — unless the §A2/§0f
  //     mention is explicitly positioned as the resolution of the
  //     mandate (contains phrase "documented resolution", "as
  //     resolved above", "per §1 review", etc.).
  if (md && typeof md === "string") {
    // Extract §1 mandatory section — anything from "## 1. MANDATORY"
    // up to the next "## " heading.
    const mandatoryMatch = md.match(/##\s*1\.[^\n]*MANDATORY[\s\S]*?(?=\n##\s|\n$)/i);
    if (mandatoryMatch) {
      const mandatoryBlock = mandatoryMatch[0];
      // Everything after the mandatory block — later sections.
      const laterMd = md.slice(md.indexOf(mandatoryBlock) + mandatoryBlock.length);
      // Extract tickers from mandatory items. Match TRAIL STOP REVIEW,
      // MANDATORY EXIT, SELL/TRIM/BUY <N> sh TICKER patterns.
      const mandateTickers = new Set();
      const ticksInMandate = [
        ...mandatoryBlock.matchAll(/\*\*TRAIL STOP REVIEW[^*]*\*\*\s*—\s*\*\*([A-Z]{1,5}(?:\.[A-Z]{1,3})?)/g),
        ...mandatoryBlock.matchAll(/\*\*(?:MANDATORY EXIT|SELL AT MARKET|TIGHTEN STOP|CORE REBALANCE|CASH DEPLOY|SWAP)[^*]*\*\*[^\n]*?([A-Z]{2,5}(?:\.[A-Z]{1,3})?)/g),
        ...mandatoryBlock.matchAll(/\b(?:BUY|SELL|EXIT|TRIM|ADD)\s+\d+\s+sh\s+([A-Z]{1,5}(?:\.[A-Z]{1,3})?)/g),
      ];
      for (const m of ticksInMandate) {
        const base = String(m[1]).toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
        if (base && base.length >= 1) mandateTickers.add(base);
      }
      // For each ticker, look for HOLD/no-action language on THE SAME
      // LINE/BULLET as the ticker mention. Cross-line windows produced
      // false positives when one bullet said "HOLD into earnings" (for
      // ticker A) and the NEXT bullet was ticker B's mandate echo —
      // the check wrongly attributed A's HOLD to B.
      //
      // Allowed exceptions (bullet references the mandate rather than
      // contradicting it): "resolved above", "per §N", "as resolved
      // above", "EXITING PER §…", "TRAIL STOP REVIEW", "MANDATORY
      // EXIT", "see §1/§0", "above". Bolded directive phrases that
      // literally repeat a mandate header are echoes, not contradictions.
      const RESOLUTION_MARKERS = /(resolved above|as (?:documented|resolved) above|per\s*§\s*\d|per\s*section\s*\d|as decided (?:above|in §\d)|exiting per\s*§|trail stop review|mandatory exit|see\s*§\s*\d|core rebalance|cash deploy|swap\s*[→\-]|as noted above|documented above|noted in\s*§\s*\d)/i;
      for (const base of mandateTickers) {
        const tickerRe = new RegExp(`\\b${base}(?:\\.[A-Z]{1,3})?\\b`, "g");
        let lm;
        while ((lm = tickerRe.exec(laterMd)) !== null) {
          // Extract JUST the ticker's own bullet/line. Walk back to
          // the nearest "\n- ", "\n* ", or "\n" and forward to the
          // next "\n". This is what the operator reads together, so
          // a HOLD outside this range isn't attributable to this
          // ticker.
          const priorBreak = laterMd.lastIndexOf("\n", lm.index);
          const lineStart = priorBreak >= 0 ? priorBreak + 1 : 0;
          const lineEnd = laterMd.indexOf("\n", lm.index);
          const line = laterMd.slice(lineStart, lineEnd > 0 ? lineEnd : laterMd.length);
          const noActionRe = /\b(no action|HOLD(?:ING)?|mechanical noise|do not (?:exit|trim|sell)|informational only|long-horizon (?:CORE|hold))\b/i;
          if (!noActionRe.test(line)) continue;
          if (RESOLUTION_MARKERS.test(line)) continue; // OK — the bullet explicitly references the mandate
          blockers.push({
            check: "mandate-vs-noaction-contradiction",
            reason: `${base} appears in §1 MANDATORY but a later section says HOLD / no-action / mechanical noise without referencing the mandate`,
            detail: `Excerpt: …${line.replace(/\s+/g, " ").trim().slice(0, 200)}…\n\nA mandate can only be softened by an explicit reference to §1 (e.g. "as resolved above", "per §1", "EXITING PER §0c", "TRAIL STOP REVIEW"). Silent contradictions leave the operator with two opposite instructions on the same ticker. Fix upstream: either drop the §1 mandate (if the later analysis is right) or strip the later HOLD language (if the mandate is right).`,
          });
          break; // one contradiction per ticker is enough — don't spam
        }
      }
    }
  }

  // ─── 9 (Phase 4): impossible-stop detector on every held position.
  // Per spec §24: "A case such as a stock trading near $207 while the
  // system claims a $274 hard stop was breached should trigger a
  // HIGH-SEVERITY DATA/LOGIC ERROR requiring validation before
  // producing an EXIT instruction." Also catches trailing stop > HWM.
  if (canonical) {
    for (const pos of canonical.positions) {
      if (pos.hard_stop_above_current) {
        blockers.push({
          check: "impossible-hard-stop",
          reason: `${pos.ticker} hard stop $${pos.hard_stop_price?.toFixed(2)} is ABOVE current price $${pos.current_price?.toFixed(2)}`,
          detail: "Long-side hard stop above current price is either bad data or a short-side rec mis-classified as long. Fix upstream before emitting any EXIT signal.",
        });
      }
      if (pos.trailing_stop_above_current) {
        blockers.push({
          check: "impossible-trailing-stop",
          reason: `${pos.ticker} trailing stop $${pos.trailing_stop_price?.toFixed(2)} is ABOVE current price $${pos.current_price?.toFixed(2)}`,
          detail: "Trailing stop above current price cannot be right for a long.",
        });
      }
      if (pos.trail_stop_above_hwm) {
        blockers.push({
          check: "trailing-stop-exceeds-hwm",
          reason: `${pos.ticker} trailing stop $${pos.trailing_stop_price?.toFixed(2)} exceeds HWM $${pos.trailing_hwm?.toFixed(2)}`,
          detail: "Trailing stop cannot legitimately exceed the high-water mark it's trailing.",
        });
      }
    }
  }

  // ─── 10 (Phase 4): percentage reconciliation via canonical engine.
  // Per spec §24: portfolio weights reconcile to ~100%; sleeve weights
  // to (100 - cash%); account weights to 100%. Any drift beyond
  // tolerance surfaces as an audit warning (not a blocker — rounding
  // is normal — but the diagnostic panel needs to see it).
  if (canonical?.reconciliation) {
    for (const w of canonical.reconciliation.warnings || []) {
      // Only impossible-in-code drifts block; data-shape warnings are
      // informational. Empty-portfolio + missing-price cases are
      // logged as warnings so the caller isn't blocked by an edge
      // case in a fresh account.
      if (w.code === "empty-portfolio" || w.code === "positions-missing-price") {
        warnings.push({ check: `reconciliation-${w.code}`, detail: w.message });
      } else if (w.code === "concentration-breach") {
        // Concentration breach is already surfaced upstream by
        // ruleSingleNameCap; only re-warn (never block) here so the
        // audit doesn't double-suppress.
        warnings.push({ check: `reconciliation-${w.code}`, detail: w.message });
      } else {
        blockers.push({
          check: `reconciliation-${w.code}`,
          reason: w.message,
          detail: "Percentages must reconcile before a briefing can be trusted. If this fires, a calc-site is computing weights outside the canonical engine.",
        });
      }
    }
  }

  // ─── 11 (Phase 4): cross-section consistency for accepted recs.
  // Per spec §24 "Cross-Section Consistency": if RY has 6.0% weight in
  // holdings, it cannot appear as 5.4% elsewhere. Every rec on a held
  // ticker should agree with the canonical position weight.
  if (canonical) {
    for (const rec of (acceptedRecs || [])) {
      if (!rec?.ticker) continue;
      const canonPos = getCanonicalPosition(canonical, rec.ticker);
      if (!canonPos) continue; // rec on non-held ticker — cross-section n/a
      // If rec carries an explicit portfolio_weight_pct field, it must
      // match canonical within tolerance. Recs today rarely stamp
      // this field, so this rule only fires on the new structured-
      // rec shape landing in Phase 3 — but it's now enforced.
      if (Number.isFinite(rec.portfolio_weight_pct)) {
        const drift = Math.abs(rec.portfolio_weight_pct - canonPos.position_weight_pct);
        if (drift > 0.5) {
          blockers.push({
            check: "rec-weight-vs-canonical-drift",
            reason: `${rec.action} ${rec.ticker}: rec cites portfolio_weight_pct=${rec.portfolio_weight_pct.toFixed(2)}%, canonical=${canonPos.position_weight_pct.toFixed(2)}%`,
            detail: "Cross-section consistency: every rec must reference the same canonical position weight. Recompute via portfolioCalcEngine before emitting.",
          });
        }
      }
    }
  }

  // ─── 11a (audit fix #223): canonical account labeling.
  // AI prose can drift the same account_id under multiple names —
  // user flagged "buy XEQT in Non-Spousal (59659702)" and "buy XEQT
  // in RRSP (59659702)" for the same account. That is a data-
  // integrity failure: the account_id → account_type mapping is
  // canonical (lives on profile.accounts), the AI must never rename.
  //
  // Scan md for any "<label> (<accountId>)" pattern and cross-check
  // the label against the canonical account name for that id. Also
  // catch the mirror bug: same label used for two different ids.
  if (md && typeof md === "string" && profile?.accounts?.length) {
    // Build the canonical maps once.
    const canonicalByIdSuffix = new Map(); // last-4-digit suffix → canonical name
    const canonicalById = new Map();
    for (const a of profile.accounts) {
      if (!a?.id || !a?.name) continue;
      const idStr = String(a.id);
      canonicalById.set(idStr, a.name);
      // Also index by trailing digits so recs that cite the short id
      // (last 4-8 digits) still match. AI often shortens account
      // numbers in prose for readability.
      const trail4 = idStr.slice(-4);
      const trail8 = idStr.slice(-8);
      if (trail4.length === 4) canonicalByIdSuffix.set(trail4, a.name);
      if (trail8.length === 8) canonicalByIdSuffix.set(trail8, a.name);
    }
    // Match patterns like "Non-Spousal (59659702)" or "RRSP (12345678)".
    // Account labels are alpha + hyphen; ids are 4-12 digits.
    const labelIdRe = /\b([A-Z][A-Za-z\- ]{2,24}?)\s*\((\d{4,12})\)/g;
    const observed = new Map(); // idStr → Set<label>
    let m;
    while ((m = labelIdRe.exec(md)) !== null) {
      const rawLabel = String(m[1]).trim();
      const idStr = String(m[2]).trim();
      // Skip false-positive labels that clearly aren't account names.
      if (/^(Note|CAD|USD|Est|Ref|Cash|Total|Buy|Sell|Trim|Add|Exit|Hold|Target|Stop|Entry)$/i.test(rawLabel)) continue;
      if (!observed.has(idStr)) observed.set(idStr, new Set());
      observed.get(idStr).add(rawLabel);
    }
    for (const [idStr, labelsSet] of observed) {
      const labels = [...labelsSet];
      // Look up canonical: full id first, then trailing suffix.
      const canonical = canonicalById.get(idStr) || canonicalByIdSuffix.get(idStr);
      // Sanity: if id doesn't match any known account, skip (could be a
      // random parenthetical number in the AI's prose).
      if (!canonical) continue;
      // Normalize labels for comparison (case-insensitive, strip
      // punctuation). Any variance that doesn't collapse to the same
      // token is a real conflict.
      const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
      const canonicalNorm = norm(canonical);
      const nonMatching = labels.filter(l => norm(l) !== canonicalNorm);
      if (nonMatching.length > 0) {
        blockers.push({
          check: "account-label-mismatch",
          reason: `Account id ${idStr} labeled as ${JSON.stringify(labels)} in prose but canonical name is "${canonical}"`,
          detail: "AI must not rename accounts. account_id → account_name is canonical from profile.accounts; the rec body must cite the canonical name or omit the label. Bug scenario: two recs on the same account get labeled with different names, misdirecting the operator to the wrong destination.",
        });
      }
    }
    // Mirror check: same label pointing at two different account_ids
    // that both exist in canonical. If Non-Spousal (12345678) and
    // Non-Spousal (87654321) both appear but both ids are real, one is
    // wrong.
    const labelToIds = new Map();
    for (const [idStr, labelsSet] of observed) {
      for (const l of labelsSet) {
        const key = String(l).toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!labelToIds.has(key)) labelToIds.set(key, new Set());
        labelToIds.get(key).add(idStr);
      }
    }
    for (const [labelKey, idsSet] of labelToIds) {
      if (idsSet.size <= 1) continue;
      const idsInCanonical = [...idsSet].filter(id => canonicalById.has(id) || canonicalByIdSuffix.has(id));
      if (idsInCanonical.length > 1) {
        blockers.push({
          check: "account-label-collision",
          reason: `Label "${labelKey}" applied to multiple distinct account ids: ${idsInCanonical.join(", ")}`,
          detail: "One label mapping to two real account ids is definitionally wrong — pick the correct id for that account and re-emit.",
        });
      }
    }
  }

  // ─── 11b (audit fix #6): rendered sleeve percentages + cash must
  // reconcile to ~100% and enumerate all four sleeves. AI's sleeve
  // one-liner in §0/§3 sometimes drops SWING or reports partial
  // percentages. Canonical is authoritative — text must match.
  if (md && typeof md === "string" && canonical) {
    // Look for a line like "CORE: 78% · SWING: 5% · INCOME: 12% · SPEC: 5% · Cash: 3%"
    // Loose regex — the AI can render varying separators / order.
    const pctScan = (label) => {
      const re = new RegExp(`${label}\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)%`, "i");
      const m = md.match(re);
      return m ? Number(m[1]) : null;
    };
    const rendered = {
      core: pctScan("CORE"),
      swing: pctScan("SWING"),
      income: pctScan("INCOME"),
      spec: pctScan("SPEC"),
      cash: pctScan("Cash"),
    };
    // Only fire when the AI clearly rendered a sleeve summary line
    // (at least CORE + one other found). Portfolio-total-only briefings
    // that skip the sleeve breakdown aren't the concern here.
    const foundSleeves = Object.entries(rendered).filter(([k, v]) => k !== "cash" && v != null).length;
    if (foundSleeves >= 2) {
      for (const k of ["core", "swing", "income", "spec"]) {
        if (rendered[k] == null) {
          blockers.push({
            check: "rendered-sleeve-missing",
            reason: `Rendered sleeve summary omits ${k.toUpperCase()} (found: ${Object.keys(rendered).filter(x => rendered[x] != null).join(", ")})`,
            detail: "All four sleeves must appear whenever any sleeve is rendered — omitting one (typically SWING or INCOME) is a display bug that hides real allocation.",
          });
        }
      }
      const renderedSum = ["core","swing","income","spec","cash"].reduce((s, k) => s + (rendered[k] || 0), 0);
      if (renderedSum > 0 && Math.abs(renderedSum - 100) > 2.5) {
        blockers.push({
          check: "rendered-sleeve-cash-not-100",
          reason: `Sleeve % + cash % sums to ${renderedSum.toFixed(1)}% (expected ~100%)`,
          detail: `Rendered: CORE ${rendered.core ?? "?"}% · SWING ${rendered.swing ?? "?"}% · INCOME ${rendered.income ?? "?"}% · SPEC ${rendered.spec ?? "?"}% · Cash ${rendered.cash ?? "?"}%. Should reconcile. Check the AI's summary line against canonical.`,
        });
      }
    }
  }

  // ─── 11c (audit fix #5): redeploy cost ≤ proceeds + available cash.
  // For every SELL/TRIM/EXIT rec paired with a matching BUY/ADD rec in
  // the same (account, currency), verify redeploy_cost <= sell_proceeds
  // + starting_cash_in_that_account. Prevents "sell $2k / buy $8k" recs
  // that assume phantom cash. Uses the canonical account cash + rec
  // (shares × entryPrice) as the transaction estimates.
  if (canonical && Array.isArray(acceptedRecs)) {
    // Bucket recs by (account, currency).
    const byBucket = new Map();
    for (const rec of acceptedRecs) {
      if (!rec?.account || !rec?.entryCurrency) continue;
      const key = `${rec.account}|${rec.entryCurrency}`;
      if (!byBucket.has(key)) byBucket.set(key, []);
      byBucket.get(key).push(rec);
    }
    for (const [key, recs] of byBucket) {
      const [acctId, ccy] = key.split("|");
      const acct = canonical.accounts.find(a => String(a.account_id) === String(acctId));
      const startingCash = ccy === "CAD" ? (acct?.cash_cad || 0) : (acct?.cash_usd || 0);
      let proceeds = 0;
      let cost = 0;
      for (const r of recs) {
        const shares = Number(r.shares) || 0;
        const price = Number(r.entryPrice) || 0;
        if (shares <= 0 || price <= 0) continue;
        const val = shares * price;
        if (["SELL", "TRIM", "EXIT"].includes(r.action)) proceeds += val;
        else if (["BUY", "ADD"].includes(r.action)) cost += val;
      }
      const available = startingCash + proceeds;
      if (cost > available + 1) { // $1 rounding tolerance
        blockers.push({
          check: "redeploy-exceeds-proceeds-plus-cash",
          reason: `Bucket ${acctId}/${ccy}: BUY cost $${cost.toFixed(0)} > proceeds $${proceeds.toFixed(0)} + starting cash $${startingCash.toFixed(0)} ($${(cost - available).toFixed(0)} short)`,
          detail: "A rec batch must fund itself. Either shrink the BUY, add an explicit trim, or cite cross-account cash movement (a WITHDRAW→DEPOSIT rec) — never assume phantom cash.",
        });
      }
    }
  }

  // ─── 12 (Phase 4): sleeve-limit gate on BUY recs.
  // Per spec §24 "Recommendation/Allocation Alignment": if a sleeve is
  // at/above max, the system cannot issue another BUY into that sleeve
  // without simultaneously recommending where the required allocation
  // comes from. The Phase 5 trade-impact simulator will make this
  // precise (portfolio pro-forma); this is the coarse pre-check.
  if (canonical) {
    for (const rec of (acceptedRecs || [])) {
      if (rec.action !== "BUY" && rec.action !== "ADD") continue;
      const sleeve = rec.sleeve ? String(rec.sleeve).toLowerCase() : null;
      if (!sleeve) continue;
      const canonSleeve = getCanonicalSleeve(canonical, sleeve);
      if (!canonSleeve || canonSleeve.sleeve_target_pct == null) continue;
      // 2pp tolerance matches the existing concentration tolerance
      // used elsewhere in the codebase.
      if (canonSleeve.sleeve_weight_pct > (canonSleeve.sleeve_target_pct + 2)) {
        // Only block if this rec would push further into an already-
        // over sleeve — check for a paired TRIM/SELL in the same batch.
        const hasPairedTrim = (acceptedRecs || []).some(r =>
          (r.action === "SELL" || r.action === "TRIM" || r.action === "EXIT") &&
          String(r.sleeve || "").toLowerCase() === sleeve
        );
        if (!hasPairedTrim) {
          blockers.push({
            check: "sleeve-over-limit-buy",
            reason: `${rec.action} ${rec.ticker} into sleeve="${sleeve}" (${canonSleeve.sleeve_weight_pct.toFixed(1)}%) which is over target (${canonSleeve.sleeve_target_pct}%) with no paired trim/sell in this batch`,
            detail: "Sleeve is already over its configured target. A BUY into an over sleeve needs a paired TRIM/SELL specifying where the required allocation comes from.",
          });
        }
      }
    }
  }

  const elapsedMs = Date.now() - t0;
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    ranAt: new Date().toISOString(),
    elapsedMs,
    stats: {
      recsChecked: (acceptedRecs || []).length,
      heldPositions: heldBases.size,
      blockersCount: blockers.length,
      warningsCount: warnings.length,
    },
  };
}

// Compact formatter for the failure email + Mongo error field. Keeps
// blockers/warnings under ~500 chars so lastBriefingErrorMessage
// stays legible.
export function summarizeAuditFailure(audit) {
  if (!audit || audit.ok) return "";
  const lines = ["Briefing suppressed by pre-send audit:"];
  for (const b of (audit.blockers || []).slice(0, 5)) {
    lines.push(`• [${b.check}] ${b.reason}`);
  }
  if ((audit.blockers || []).length > 5) {
    lines.push(`• ... and ${audit.blockers.length - 5} more`);
  }
  return lines.join("\n").slice(0, 500);
}
