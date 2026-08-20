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
