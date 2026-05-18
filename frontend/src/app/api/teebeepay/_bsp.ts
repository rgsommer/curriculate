// frontend/src/app/api/teebeepay/_bsp.ts
//
// BSP Batch Manager CSV. Real 12-column legacy format observed in the
// historical archive — exactly what BSP's batch-upload service accepts.
//
//   Row 1 (meta):
//     BSP,<source_company_name>,<bsp_client_no>,PAYROLL,<YYYYMMDD>,,,,,,,
//   Rows 2..N (one per credit):
//     <dest_bank>,<dest_branch>,<dest_suffix>,<dest_account_no>,53,
//     <amount>,<NAME>,<description>,<src_bank>,<src_branch>,<src_suffix>,<src_account_no>

function esc(v: any) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function yyyymmdd(s: string) {
  return String(s || "").replace(/-/g, "").slice(0, 8);
}
function fmtName(emp: any, account: any) {
  if (account?.account_name) return account.account_name;
  const last = (emp.last_name || "").trim();
  const first = (emp.first_name || "").trim();
  if (emp.name_format === "legacy") return (last + "-" + first).toUpperCase();
  return (first + " " + last).trim();
}
function payDescription(emp: any, company: any) {
  const abbr = (company.abbreviation || company.name || "PAY").slice(0, 8).toUpperCase();
  return `${abbr} ${emp.pay_type === "hourly" ? "WAGES" : "SALARY"}`;
}

// Split one employee's net across their bank_accounts. Rounding remainder
// lands on the first account so amounts sum exactly to net.
function splitNet(emp: any, net: number) {
  const accounts = (emp.bank_accounts && emp.bank_accounts.length)
    ? emp.bank_accounts
    : [{
        bank_id: null,
        branch_code: emp.branch_code || null,
        account_no: emp.bank_account_no || "",
        account_name: emp.bank_account_name || "",
        percentage: 100,
      }];
  if (!net || net <= 0) return [];
  const out = accounts.map((a: any) => ({
    employee: emp,
    account_name: a.account_name || "",
    account_no:   a.account_no   || "",
    branch_code:  a.branch_code  || emp.branch_code || "307",
    bank_code:    a.bank_code    || "088",
    suffix:       a.suffix       || "002",
    amount: Math.round((net * (Number(a.percentage) || 0) / 100) * 100) / 100,
  }));
  const drift = +(net - out.reduce((s: number, r: any) => s + r.amount, 0)).toFixed(2);
  if (out.length && Math.abs(drift) >= 0.01) {
    out[0].amount = +(out[0].amount + drift).toFixed(2);
  }
  return out.filter((r: any) => r.amount > 0 && r.account_no);
}

function bodyRow(o: any) {
  return [
    o.dest_bank, o.dest_branch, o.dest_suffix, o.dest_account_no,
    "53", Number(o.amount).toFixed(2), o.name, o.description,
    o.src_bank, o.src_branch, o.src_suffix, o.src_account_no,
  ].map(esc).join(",");
}

export function buildBspBatch(company: any, period: any, rows: any[], serviceFees: any[] = []) {
  const src_bank   = company.bank_code   || "088";
  const src_branch = company.branch_code || "314";
  const src_suffix = company.bank_account_suffix || "002";
  const src_acct   = company.bank_account_no || "";

  const meta = [
    "BSP",
    (company.name || "").slice(0, 30),
    company.bank_client_no || "",
    "PAYROLL",
    yyyymmdd(period.pay_date || period.period_end),
    "", "", "", "", "", "", "",
  ].map(esc).join(",");

  const lines: string[] = [];

  // Employee net rows (with multi-bank split)
  for (const r of rows) {
    const net = Number((r.entry && r.entry.net) ?? r.net ?? 0);
    if (net <= 0) continue;
    const splits = splitNet(r.employee, net);
    for (const s of splits) {
      lines.push(bodyRow({
        dest_bank: s.bank_code, dest_branch: s.branch_code,
        dest_suffix: s.suffix, dest_account_no: s.account_no,
        amount: s.amount,
        name: fmtName(r.employee, s),
        description: payDescription(r.employee, company),
        src_bank, src_branch, src_suffix, src_account_no: src_acct,
      }));
    }
  }

  // Service-fee rows (Theresia 3%, you 2%, etc.)
  for (const f of (serviceFees || [])) {
    if (!(Number(f.amount) > 0) || !f.account_no) continue;
    lines.push(bodyRow({
      dest_bank: f.bank_code || "088",
      dest_branch: f.branch_code || src_branch,
      dest_suffix: "002",
      dest_account_no: f.account_no,
      amount: f.amount,
      name: f.account_name || f.name,
      description: `${(company.abbreviation || "PAY").slice(0, 8).toUpperCase()} ${yyyymmdd(period.pay_date || period.period_end)}`,
      src_bank, src_branch, src_suffix, src_account_no: src_acct,
    }));
  }
  return [meta, ...lines].join("\n") + "\n";
}
