// Shared service-fee computation. Used by:
//   - /payroll-periods/[pid]/approve  (in-app approval)
//   - /approve-via-email              (magic-link approval)
//
// Two models, picked per company:
//
//   A) Flat-rate (preferred, modern):
//      totalFee = active_employees × company.flat_rate_per_employee
//      each recipient gets (weight / sum_of_weights) × totalFee.
//      Use this when company.flat_rate_per_employee > 0.
//
//   B) % of gross (legacy):
//      each recipient gets (weight / 100) × totalGross.
//      Falls back here when flat_rate_per_employee is unset/zero.
//
// `weight` is the renamed `pct_of_gross` field on service_fees. We read both
// for backward compatibility; new writes use `weight`.

export interface ServiceFeeRow {
  name: string;
  weight: number;
  amount: number;
  account_no?: string;
  account_name?: string;
  branch_code?: string;
  model: "flat_rate" | "pct_of_gross";
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Pricing defaults — kept in sync with /pricing-defaults/route.ts. Inlined here
// to avoid an extra DB call on every approval; if you change the bureau-wide
// rate via the API, override the per-company `flat_rate_per_employee` for
// existing companies or accept that they'll fall through to these constants.
const DEFAULT_BASIC_RATE = 9;
const DEFAULT_FULL_RATE  = 14;

export async function effectiveRate(dbi: any, company: any): Promise<number> {
  const override = Number(company?.flat_rate_per_employee || 0);
  if (override > 0) return override;
  const tier = company?.service_level === "full" ? "full" : "basic";
  // Try system-wide defaults first
  try {
    const sys: any = await dbi.collection("system_settings").findOne({ _id: "pricing_defaults" as any });
    if (sys) {
      if (tier === "full" && sys.full_rate_per_employee != null) return Number(sys.full_rate_per_employee);
      if (tier === "basic" && sys.basic_rate_per_employee != null) return Number(sys.basic_rate_per_employee);
    }
  } catch { /* fall through */ }
  // Hard-coded fallbacks
  return tier === "full" ? DEFAULT_FULL_RATE : DEFAULT_BASIC_RATE;
}

export function computeServiceFees(
  company: any,
  totalGross: number,
  activeEmployees: number,
  feesRaw: any[],
  resolvedRate?: number,                       // optional pre-resolved rate (from effectiveRate())
): ServiceFeeRow[] {
  // If caller pre-resolved (preferred), use that; otherwise inspect the company override.
  const rate = resolvedRate != null
    ? Number(resolvedRate)
    : Number(company?.flat_rate_per_employee || 0);
  const useFlat = rate > 0;
  const fees = feesRaw.map((f) => ({
    name: f.name,
    weight: Number(f.weight ?? f.pct_of_gross) || 0,
    account_no: f.account_no,
    account_name: f.account_name,
    branch_code: f.branch_code,
  }));

  if (useFlat) {
    const totalFee = r2(rate * Math.max(0, activeEmployees));
    const sumWeights = fees.reduce((s, f) => s + f.weight, 0);
    return fees.map((f) => ({
      ...f,
      amount: sumWeights > 0 ? r2(totalFee * f.weight / sumWeights) : 0,
      model: "flat_rate" as const,
    }));
  }
  // Legacy: % of gross
  return fees.map((f) => ({
    ...f,
    amount: r2(totalGross * f.weight / 100),
    model: "pct_of_gross" as const,
  }));
}
