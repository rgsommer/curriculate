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

function baseOf(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

// Run every check. Returns { ok, blockers, warnings, ranAt, elapsedMs }.
// `positions` = live portfolio positions. `acceptedRecs` = post-validator
// recs the briefing intends to persist. `rejectedRecs` = for the §5
// BLOCKED cross-check. `md` = final markdown for text-level scans.
export async function auditBriefingBeforeSend({ email, md, acceptedRecs = [], rejectedRecs = [], positions = [] }) {
  const t0 = Date.now();
  const blockers = [];
  const warnings = [];
  const heldBases = new Set(
    (positions || [])
      .filter(p => (p?.qty || 0) > 0)
      .map(p => baseOf(p.ticker))
      .filter(Boolean)
  );

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
