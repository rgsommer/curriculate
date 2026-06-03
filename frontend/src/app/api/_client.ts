// Light client linking: records across audit / tax / loans / payroll are stored
// under whatever name each was typed with ("… Limited 2025" vs "… Ltd"). Rather
// than a shared client table + backfill, we normalise names to a "client key"
// (lowercase, entity suffixes and year tags and punctuation stripped) and match
// on that — equal or containment — so a company's records join even when the
// names differ slightly.
import type { Db } from "mongodb";

export function clientKey(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, " ")                                   // year tags: "2025"
    .replace(/\bfy\s*20?\d{2}\b/g, " ")                             // "FY25" / "FY2025"
    .replace(/\b(pty|ltd|limited|inc|incorporated|llc|plc|co|company)\b/g, " ") // entity suffixes
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")                                    // punctuation → space
    .replace(/\s+/g, " ")
    .trim();
}

function escRx(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// True when two names refer to the same client by normalised key.
export function sameClient(a: string, b: string): boolean {
  const ka = clientKey(a), kb = clientKey(b);
  if (!ka || !kb) return false;
  return ka === kb || ka.includes(kb) || kb.includes(ka);
}

// Gather a client's records across all four products by normalised key. Narrows
// the DB scan with a regex on the most distinctive token, then filters by key.
export async function findClientRecords(dbi: Db, name: string): Promise<{ audit: any[]; tax: any[]; loans: any[]; payroll: any[] }> {
  const empty = { audit: [], tax: [], loans: [], payroll: [] };
  const key = clientKey(name);
  if (!key) return empty;
  const tokens = key.split(" ").filter((t) => t.length >= 4).sort((a, b) => b.length - a.length);
  const anchor = tokens[0] || key.split(" ")[0] || key;
  const rx = new RegExp(escRx(anchor), "i");

  const [audit, tax, loans, payroll] = await Promise.all([
    dbi.collection("audit_engagements").find({ company_name: rx }).limit(80).toArray(),
    dbi.collection("tax_returns").find({ taxpayer_name: rx }).limit(80).toArray(),
    dbi.collection("loan_applications").find({ business_name: rx }).limit(80).toArray(),
    dbi.collection("companies").find({ name: rx }).limit(40).toArray(),
  ]);
  return {
    audit: audit.filter((e: any) => sameClient(e.company_name, name)),
    tax: tax.filter((r: any) => sameClient(r.taxpayer_name, name)),
    loans: loans.filter((a: any) => sameClient(a.business_name, name)),
    payroll: payroll.filter((c: any) => sameClient(c.name, name)),
  };
}
