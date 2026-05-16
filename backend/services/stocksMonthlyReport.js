// backend/services/stocksMonthlyReport.js
//
// Builds the monthly-report block for each account flagged with
// monthlyReportEnabled. Pulls snapshots at period boundaries (month start,
// year start, agreement start) and computes period P&L, YTD, inception P&L.
//
// For accounts with a beneficiary agreement (e.g. Richard's TFSA cash held
// for his daughter Tamara on a 3%-interest agreement with profit-share),
// adds the live payout calculation:
//
//   I_owed   = principalCad × interestRatePct/100 × yearsSinceStart
//   profit   = currentValueCad − principalCad
//   share    = max(0, profit) × profitSharePct/100        (positive profit only)
//   payout   = principalCad + I_owed + share              (what beneficiary gets)
//   inflows  = Σ (monthly + yearly recurring inflows since startDate)
//   netCarry = inflows − I_owed                           (positive = bene owes user net)
//
// If carryLosses=true and profit<0, beneficiary still gets principal+interest;
// user absorbs the V−P shortfall.
//
// Both the daily briefing (last market day of month) and the dedicated
// end-of-month email use this module.

import StocksPortfolioSnapshot from "../models/StocksPortfolioSnapshot.js";

// Compute account current value in CAD (equity + cash). Mirrors the snapshot
// builder so on-the-fly numbers reconcile with what the chart shows.
export function accountValueCad(profile, accountId) {
  const fx = profile.fxUsdCad || 1.37;
  const acct = (profile.accounts || []).find((a) => a.id === accountId);
  if (!acct) return { totalCad: 0, equitiesCad: 0, cashCad: 0, cashUsd: 0 };
  let equitiesCad = 0;
  for (const p of profile.positions || []) {
    if (p.acct !== accountId) continue;
    const val = p.ccy === "USD"
      ? (p.priceCad ?? (p.priceUsd ? p.priceUsd * fx : 0)) * (p.qty || 0)
      : (p.priceCad || 0) * (p.qty || 0);
    equitiesCad += val;
  }
  const cashCad = acct.cashCad || 0;
  const cashUsd = acct.cashUsd || 0;
  const cashCadEquiv = cashCad + cashUsd * fx;
  return {
    totalCad: equitiesCad + cashCadEquiv,
    equitiesCad,
    cashCad,
    cashUsd,
    cashCadEquiv,
  };
}

// Unrealized profit on positions actually held in the account, computed from
// recorded cost basis (price - basis) × qty. This is the "real" investment
// P&L — it does NOT include cash from additional contributions, deposits, or
// withdrawals, which `currentValue − principal` would conflate.
//
// Returns { profitCad, coveragePct, positionsCount, positionsCovered }.
// coveragePct flags how reliable the number is: 1.0 means every position has
// cost basis recorded; lower numbers mean some positions are missing basis
// and were excluded from the sum.
export function accountUnrealizedProfit(profile, accountId) {
  const fx = profile.fxUsdCad || 1.37;
  let profitCad = 0;
  let positionsCount = 0;
  let positionsCovered = 0;
  for (const p of profile.positions || []) {
    if (p.acct !== accountId) continue;
    positionsCount++;
    const qty = p.qty || 0;
    if (qty === 0) continue;
    if (p.ccy === "USD") {
      const price = p.priceUsd;
      const basis = p.costBasisUsd;
      if (price == null || basis == null) continue;
      const pnlUsd = (price - basis) * qty;
      profitCad += pnlUsd * fx;
      positionsCovered++;
    } else {
      const price = p.priceCad;
      const basis = p.costBasisCad;
      if (price == null || basis == null) continue;
      profitCad += (price - basis) * qty;
      positionsCovered++;
    }
  }
  const coveragePct = positionsCount > 0 ? positionsCovered / positionsCount : 1;
  return { profitCad, coveragePct, positionsCount, positionsCovered };
}

// ─────────────────────────────────────────────────────────────────────
// Beneficiary math — pure functions, easy to unit-test later
//
// `profitCad` is the actual investment P&L (realized + unrealized) and
// should be computed via cost-basis math by the caller — NOT via
// (currentValue − principal), which conflates investment profit with later
// cash contributions/withdrawals. Pass the real number. If you omit it,
// the legacy `currentValueCad − principal` fallback runs (kept for
// backward-compat only).
//
// `profitCoverage` is the share (0..1) of positions whose cost basis was
// available when computing profitCad — lets the report flag when the
// number is partial.
// ─────────────────────────────────────────────────────────────────────
export function computeBeneficiaryPayout(ba, currentValueCad, asOf = new Date(), profitCad = null, profitCoverage = 1) {
  if (!ba || !ba.enabled) return null;
  const principalAmt = ba.principalCad || 0;
  const ratePct = ba.interestRatePct || 0;
  const shareePct = ba.profitSharePct || 0;
  const agreementStart = ba.startDate ? new Date(ba.startDate) : null;
  // Principal placement date — falls back to agreementStart when null. Before
  // this date the principal hasn't been placed, so no interest accrues and
  // no profit-share applies (principal = 0).
  const principalStart = ba.principalStartDate
    ? new Date(ba.principalStartDate)
    : agreementStart;
  const principalActive = !principalStart || asOf >= principalStart;
  const principal = principalActive ? principalAmt : 0;
  const yearsSincePrincipalStart = principalStart && principalActive
    ? Math.max(0, (asOf.getTime() - principalStart.getTime()) / (365.25 * 86400 * 1000))
    : 0;
  const yearsSinceStart = agreementStart
    ? Math.max(0, (asOf.getTime() - agreementStart.getTime()) / (365.25 * 86400 * 1000))
    : 0;

  const interestOwed = principal * (ratePct / 100) * yearsSincePrincipalStart;
  // Use explicit profit (cost-basis math) when caller provides it; otherwise
  // fall back to the old value-minus-principal estimate.
  const profit = (typeof profitCad === "number" && Number.isFinite(profitCad))
    ? profitCad
    : (currentValueCad - principal);
  const profitBasis = (typeof profitCad === "number") ? "cost-basis" : "value-minus-principal";
  // Profit-share applies only when principal is active (otherwise there's no
  // capital at risk on the beneficiary's behalf to be sharing returns on).
  const shareToBene = principalActive ? Math.max(0, profit) * (shareePct / 100) : 0;
  const grossPayoutIfNow = principal + interestOwed + shareToBene;

  // Early-payout penalty — applies only when asOf is BEFORE lockUntilDate.
  // The penalty equals earlyPayoutPenaltyPct of the GREATER of (profit-share)
  // or (principal). Rationale: compensates the user for the tax hit they
  // would incur on early withdrawal of the account. Once past lockUntilDate
  // the penalty drops to zero.
  const lockUntil = ba.lockUntilDate ? new Date(ba.lockUntilDate) : null;
  const penaltyPct = ba.earlyPayoutPenaltyPct || 0;
  const isEarly = lockUntil && asOf < lockUntil && penaltyPct > 0;
  const penaltyBaseProfitShare = shareToBene * (penaltyPct / 100);
  const penaltyBasePrincipal = principal * (penaltyPct / 100);
  const penaltyAmount = isEarly
    ? Math.max(penaltyBaseProfitShare, penaltyBasePrincipal)
    : 0;
  const penaltyBasis = isEarly
    ? (penaltyBasePrincipal >= penaltyBaseProfitShare ? "principal" : "profit-share")
    : null;
  const payoutIfNow = grossPayoutIfNow - penaltyAmount;
  const daysUntilUnlock = lockUntil ? Math.ceil((lockUntil.getTime() - asOf.getTime()) / 86400000) : null;

  // Expected inflows from beneficiary — each inflow can have its own start
  // date (falls back to agreement startDate). This lets recurring payments
  // begin at different times: e.g. Tamara paid car insurance from Feb 1
  // while principal placement was Jun 1.
  //
  // Keep a per-item breakdown so the report can show each line — car
  // insurance, phone, room & board, etc — rather than a single opaque total.
  const yearStart = new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));

  let inflowsCad = 0;
  let inflowsPerYearCad = 0;
  let inflowsYtdCad = 0;
  const inflowItems = [];
  for (const inf of ba.inflows || []) {
    const annual = inf.frequency === "yearly" ? inf.amountCad : inf.amountCad * 12;
    // Per-inflow effective start date (defaults to agreement start)
    const infStart = inf.startDate
      ? new Date(inf.startDate)
      : agreementStart;
    const infYearsCumulative = infStart
      ? Math.max(0, (asOf.getTime() - infStart.getTime()) / (365.25 * 86400 * 1000))
      : 0;
    // YTD = from MAX(year-start, inflow-start) up to asOf
    const ytdAnchor = infStart ? Math.max(yearStart.getTime(), infStart.getTime()) : yearStart.getTime();
    const infYearsYtd = Math.max(0, (asOf.getTime() - ytdAnchor) / (365.25 * 86400 * 1000));
    const cumulative = annual * infYearsCumulative;
    const ytd = annual * infYearsYtd;
    inflowsPerYearCad += annual;
    inflowsCad += cumulative;
    inflowsYtdCad += ytd;
    inflowItems.push({
      description: inf.description || "(unlabeled)",
      amountCad: inf.amountCad,
      frequency: inf.frequency,
      startDate: infStart,
      annual,
      cumulative,
      ytd,
    });
  }
  const netCarryCad = inflowsCad - interestOwed; // positive = beneficiary owes user net
  // Interest YTD: from MAX(year-start, principalStart) up to asOf
  const interestYtdAnchor = principalStart && principalActive
    ? Math.max(yearStart.getTime(), principalStart.getTime())
    : yearStart.getTime();
  const interestYearsYtd = principalActive
    ? Math.max(0, (asOf.getTime() - interestYtdAnchor) / (365.25 * 86400 * 1000))
    : 0;
  const interestOwedYtdCad = principal * (ratePct / 100) * interestYearsYtd;

  return {
    principal,
    ratePct,
    profitSharePct: shareePct,
    yearsSinceStart,
    interestOwed,
    profit,
    shareToBene,
    payoutIfNow,
    inflowsPerYearCad,
    inflowsCad,
    netCarryCad,
    inflowsYtdCad,
    interestOwedYtdCad,
    inflowItems,
    carryLosses: ba.carryLosses !== false,
    profitBasis,
    profitCoverage,
    // Early-payout penalty details (null when not applicable)
    grossPayoutIfNow,
    penaltyPct,
    penaltyAmount,
    penaltyBasis,
    isEarly,
    lockUntilDate: lockUntil,
    daysUntilUnlock,
    // Principal-start timing
    principalActive,
    principalStartDate: principalStart,
    yearsSincePrincipalStart,
    agreementStartDate: agreementStart,
  };
}

// Fetch the closest snapshot ON OR BEFORE the given date for an account.
// Returns null if none exists (e.g., account is new or pre-dates snapshots).
async function snapshotOnOrBefore(email, accountId, dateStr) {
  return StocksPortfolioSnapshot
    .findOne({ email, accountId, date: { $lte: dateStr } })
    .sort({ date: -1 })
    .lean();
}

// Build the report payload for a single account.
export async function buildAccountReport(profile, accountId, asOf = new Date()) {
  const account = (profile.accounts || []).find((a) => a.id === accountId);
  if (!account) return null;
  const cur = accountValueCad(profile, accountId);
  const todayStr = asOf.toISOString().slice(0, 10);
  const yearStartStr = `${asOf.getUTCFullYear()}-01-01`;

  // Month start = first calendar day of current month
  const monthStartDate = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const monthStartStr = monthStartDate.toISOString().slice(0, 10);

  const [monthStartSnap, yearStartSnap, inceptionSnap] = await Promise.all([
    snapshotOnOrBefore(profile.email, accountId, monthStartStr),
    snapshotOnOrBefore(profile.email, accountId, yearStartStr),
    StocksPortfolioSnapshot.findOne({ email: profile.email, accountId }).sort({ date: 1 }).lean(),
  ]);

  const periodStartVal = monthStartSnap?.totalCad ?? null;
  const yearStartVal = yearStartSnap?.totalCad ?? null;
  const inceptionVal = inceptionSnap?.totalCad ?? null;

  const periodPnl = periodStartVal != null ? cur.totalCad - periodStartVal : null;
  const periodPct = periodStartVal && periodStartVal > 0 ? (periodPnl / periodStartVal) * 100 : null;
  const ytdPnl = yearStartVal != null ? cur.totalCad - yearStartVal : null;
  const ytdPct = yearStartVal && yearStartVal > 0 ? (ytdPnl / yearStartVal) * 100 : null;
  const inceptionPnl = inceptionVal != null ? cur.totalCad - inceptionVal : null;
  const inceptionPct = inceptionVal && inceptionVal > 0 ? (inceptionPnl / inceptionVal) * 100 : null;

  // Compute investment profit from cost basis (real P&L), not value-minus-
  // principal (which would conflate later cash deposits with trading gains).
  const unreal = accountUnrealizedProfit(profile, accountId);
  const beneficiary = computeBeneficiaryPayout(
    account.beneficiaryAgreement,
    cur.totalCad,
    asOf,
    unreal.profitCad,
    unreal.coveragePct,
  );

  return {
    accountId,
    accountName: account.name,
    asOf,
    monthLabel: asOf.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    current: cur,
    period: { start: periodStartVal, pnl: periodPnl, pct: periodPct },
    ytd: { start: yearStartVal, pnl: ytdPnl, pct: ytdPct },
    inception: { start: inceptionVal, pnl: inceptionPnl, pct: inceptionPct },
    beneficiary,
  };
}

// Build reports for every account with monthlyReportEnabled=true.
export async function buildAllAccountReports(profile, asOf = new Date()) {
  const targets = (profile.accounts || []).filter((a) => a.monthlyReportEnabled);
  return Promise.all(targets.map((a) => buildAccountReport(profile, a.id, asOf)));
}

// ─────────────────────────────────────────────────────────────────────
// Markdown formatting — used both in daily briefing (block) and in the
// standalone end-of-month email body.
// ─────────────────────────────────────────────────────────────────────
function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}
function fmtMoney(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function formatAccountReportMarkdown(report) {
  if (!report) return "";
  const { accountName, monthLabel, current, period, ytd, inception, beneficiary } = report;

  const parts = [];
  parts.push(`### ${accountName} — ${monthLabel}`);
  parts.push(`**Current value:** ${fmtMoney(current.totalCad)} CAD (equity ${fmtMoney(current.equitiesCad)} + cash ${fmtMoney(current.cashCadEquiv)})`);
  parts.push("");
  parts.push(`| Period | Start value | P&L | Return |`);
  parts.push(`|---|---|---|---|`);
  parts.push(`| This month | ${fmtMoney(period.start)} | ${fmtMoney(period.pnl)} | ${fmtPct(period.pct)} |`);
  parts.push(`| YTD | ${fmtMoney(ytd.start)} | ${fmtMoney(ytd.pnl)} | ${fmtPct(ytd.pct)} |`);
  parts.push(`| Inception | ${fmtMoney(inception.start)} | ${fmtMoney(inception.pnl)} | ${fmtPct(inception.pct)} |`);

  if (beneficiary) {
    const ba = beneficiary;
    parts.push("");
    parts.push(`**Beneficiary agreement** — principal ${fmtMoney(ba.principal)} @ ${ba.ratePct}%/yr · ${ba.profitSharePct}% profit-share · ${ba.carryLosses ? "you carry losses" : "no loss protection"}`);
    parts.push("");
    parts.push(`| Item | Amount |`);
    parts.push(`|---|---|`);
    parts.push(`| Years since agreement start | ${ba.yearsSinceStart.toFixed(2)} |`);
    if (ba.principalStartDate && (!ba.agreementStartDate || ba.principalStartDate.getTime() !== ba.agreementStartDate.getTime())) {
      const psd = new Date(ba.principalStartDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      if (ba.principalActive) {
        parts.push(`| Principal placement date | ${psd} (interest accrues from here) |`);
        parts.push(`| Years since principal placed | ${ba.yearsSincePrincipalStart.toFixed(2)} |`);
      } else {
        parts.push(`| Principal placement date | ${psd} (⏳ not placed yet — principal/interest = 0 until then) |`);
      }
    }
    parts.push(`| Interest owed (cumulative) | ${fmtMoney(ba.interestOwed)} |`);
    const profitLabel = ba.profitBasis === "cost-basis"
      ? "Unrealized P&L on open positions (cost basis)"
      : "Account profit / (loss)";
    parts.push(`| ${profitLabel} | ${fmtMoney(ba.profit)} |`);
    parts.push(`| Profit-share to beneficiary (${ba.profitSharePct}% of positive profit) | ${fmtMoney(ba.shareToBene)} |`);
    if (ba.isEarly && ba.penaltyAmount > 0) {
      const unlockStr = ba.lockUntilDate
        ? new Date(ba.lockUntilDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
        : "the agreed date";
      parts.push(`| ⚠️ Early-payout penalty (${ba.penaltyPct}% × ${ba.penaltyBasis}, locks until ${unlockStr}) | −${fmtMoney(ba.penaltyAmount)} |`);
      parts.push(`| Gross payout before penalty | ${fmtMoney(ba.grossPayoutIfNow)} |`);
      parts.push(`| **Net payout if cashed out today** | **${fmtMoney(ba.payoutIfNow)}** |`);
    } else {
      parts.push(`| **Payout if cashed out today** | **${fmtMoney(ba.payoutIfNow)}** |`);
    }
    parts.push(`| Net carry (inflows − interest owed) | ${fmtMoney(ba.netCarryCad)} |`);

    // Coverage caveat when some positions are missing cost basis
    if (ba.profitBasis === "cost-basis" && ba.profitCoverage != null && ba.profitCoverage < 1) {
      const covPct = (ba.profitCoverage * 100).toFixed(0);
      parts.push("");
      parts.push(`> ℹ️ Profit-share is based on **${covPct}% of positions** that have a recorded cost basis. Positions missing a basis are excluded from the P&L sum. Edit positions in the Holdings tab to add cost basis and get a complete number.`);
    }

    // Per-item inflows breakdown — far more useful than one rolled-up total.
    if (ba.inflowItems && ba.inflowItems.length > 0) {
      parts.push("");
      parts.push(`**Inflows from beneficiary (breakdown):**`);
      parts.push("");
      parts.push(`| Source | From | Rate | Annual | YTD | Cumulative |`);
      parts.push(`|---|---|---|---|---|---|`);
      for (const it of ba.inflowItems) {
        const rateLabel = it.frequency === "monthly"
          ? `${fmtMoney(it.amountCad)}/mo`
          : `${fmtMoney(it.amountCad)}/yr`;
        const fromLabel = it.startDate
          ? new Date(it.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
          : "—";
        parts.push(`| ${it.description} | ${fromLabel} | ${rateLabel} | ${fmtMoney(it.annual)} | ${fmtMoney(it.ytd)} | ${fmtMoney(it.cumulative)} |`);
      }
      parts.push(`| **Total** | — | — | **${fmtMoney(ba.inflowsPerYearCad)}** | **${fmtMoney(ba.inflowsYtdCad)}** | **${fmtMoney(ba.inflowsCad)}** |`);
    } else {
      parts.push(`| Expected inflows from beneficiary (cumulative) | ${fmtMoney(ba.inflowsCad)} (${fmtMoney(ba.inflowsPerYearCad)}/yr) |`);
      parts.push(`| Inflows YTD | ${fmtMoney(ba.inflowsYtdCad)} |`);
    }

    if (ba.profit < 0 && ba.carryLosses) {
      parts.push("");
      parts.push(`> ⚠️ Account is in **loss** of ${fmtMoney(ba.profit)}. You absorb this; beneficiary still receives principal + interest (${fmtMoney(ba.principal + ba.interestOwed)}).`);
    }
  }

  return parts.join("\n");
}

export function formatAllReportsMarkdown(reports) {
  if (!reports || reports.length === 0) return "";
  const blocks = reports.filter(Boolean).map(formatAccountReportMarkdown);
  if (blocks.length === 0) return "";
  return `## 📊 Monthly account reports\n\n${blocks.join("\n\n---\n\n")}`;
}

// ─────────────────────────────────────────────────────────────────────
// Last-trading-day-of-month detection. Approximation: the last weekday
// (Mon-Fri) of the calendar month. Doesn't handle exchange holidays
// perfectly, but is close enough — if a holiday falls on the last
// weekday, the report ships one day late, which is acceptable.
// ─────────────────────────────────────────────────────────────────────
export function isLastTradingDayOfMonth(date = new Date()) {
  const lastOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  // Walk backward from end of month to first weekday
  let last = new Date(lastOfMonth);
  while (last.getUTCDay() === 0 || last.getUTCDay() === 6) {
    last.setUTCDate(last.getUTCDate() - 1);
  }
  return date.getUTCFullYear() === last.getUTCFullYear()
    && date.getUTCMonth() === last.getUTCMonth()
    && date.getUTCDate() === last.getUTCDate();
}
