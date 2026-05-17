// BSP batch upload format — matched to the real legacy CSV shape that
// BSP's batch-upload service accepts.
//
// File layout:
//   Row 1 (meta header):
//     BSP,<source_company_name>,<bsp_client_no>,PAYROLL,<YYYYMMDD>,,,,,,,
//   Rows 2..N (one per credit):
//     <dest_bank>,<dest_branch>,<dest_suffix>,<dest_account_no>,53,
//     <amount>,<NAME>,<description>,<src_bank>,<src_branch>,<src_suffix>,<src_account_no>
//
// Where:
//   <dest_bank>     = '088' for BSP
//   <dest_branch>   = employee's branch code (e.g. '314', '307', '019')
//   <dest_suffix>   = '002' (account suffix; observed constant)
//   53              = BSP transaction code for "credit"
//   <NAME>          = "LAST-FIRST" for staff at the bank with hyphenated
//                     legacy account names; modern accounts use plain name.
//                     Importer accepts both. We write "Last First" for
//                     non-staff and reserve LAST-FIRST when the employee
//                     record asks for the legacy style.
//   <description>   = "<COMPANY_ABBREV> SALARY" or "<ABBREV> WAGES"
//   src_*           = the source company's account at BSP
//
// Each employee can split their net across multiple accounts; we emit one
// row per account. Service-fee rows are appended after employees.
//
// If the bank ever asks to tweak the date in row 1, the user can open the
// CSV in a plain text editor; it sits at byte 0 of the file.

function esc(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function fmtName(employee, account) {
  // Preferred: explicit account_name on the bank account row.
  if (account && account.account_name) return account.account_name;
  // Fallback: "Last-First" legacy hyphenated form when the employee was set up
  // with name_format='legacy'; otherwise plain "First Last".
  const last  = (employee.last_name || '').trim();
  const first = (employee.first_name || '').trim();
  if (employee.name_format === 'legacy') return (last + '-' + first).toUpperCase();
  return (first + ' ' + last).trim();
}

function payDescription(employee, company) {
  const abbrev = (company.abbreviation || company.name || 'PAY').slice(0, 8).toUpperCase();
  const kind = (employee.pay_type === 'hourly') ? 'WAGES' : 'SALARY';
  return `${abbrev} ${kind}`;
}

function yyyymmdd(s) {
  return String(s || '').replace(/-/g, '').slice(0, 8);
}

function splitNet(employee, net) {
  const accounts = (employee.bank_accounts && employee.bank_accounts.length)
    ? employee.bank_accounts
    : [{
        bank_id: employee.bank_id || null,
        branch_code: employee.branch_code || null,
        account_no: employee.bank_account_no || '',
        account_name: employee.bank_account_name || '',
        percentage: 100,
      }];

  if (!net || net <= 0) return [];
  const out = accounts.map(a => ({
    account_name: a.account_name || '',
    account_no:   a.account_no   || '',
    branch_code:  a.branch_code  || (employee.branch_code || '307'),
    bank_code:    a.bank_code    || '088',
    suffix:       a.suffix       || '002',
    amount:       Math.round((net * (Number(a.percentage) || 0) / 100) * 100) / 100,
    employee,
  }));
  const drift = +(net - out.reduce((s, r) => s + r.amount, 0)).toFixed(2);
  if (out.length && Math.abs(drift) >= 0.01) {
    out[0].amount = +(out[0].amount + drift).toFixed(2);
  }
  return out.filter(r => r.amount > 0 && r.account_no);
}

// Build the legacy 12-column CSV body row.
function bodyRow({ dest_bank, dest_branch, dest_suffix, dest_account_no,
                   amount, name, description,
                   src_bank, src_branch, src_suffix, src_account_no }) {
  return [
    dest_bank, dest_branch, dest_suffix, dest_account_no,
    '53', Number(amount).toFixed(2), name, description,
    src_bank, src_branch, src_suffix, src_account_no,
  ].map(esc).join(',');
}

function buildBspBatch(company, period, entries, serviceFees = []) {
  // Source side = the bureau / client company's bank account.
  const src_bank   = company.bank_code   || '088';
  const src_branch = company.branch_code || '314';
  const src_suffix = company.bank_account_suffix || '002';
  const src_acct   = company.bank_account_no || '';

  const meta = [
    'BSP',
    (company.name || '').slice(0, 30),
    company.bank_client_no || '',
    'PAYROLL',
    yyyymmdd(period.pay_date || period.period_end),
    '', '', '', '', '', '', '',
  ].map(esc).join(',');

  const rows = [];

  // Employee rows (split across accounts)
  for (const r of entries) {
    const net = Number((r.entry && r.entry.net) ?? r.net ?? 0);
    if (net <= 0) continue;
    const splits = splitNet(r.employee, net);
    for (const s of splits) {
      rows.push(bodyRow({
        dest_bank: s.bank_code, dest_branch: s.branch_code,
        dest_suffix: s.suffix, dest_account_no: s.account_no,
        amount: s.amount,
        name: fmtName(r.employee, s),
        description: payDescription(r.employee, company),
        src_bank, src_branch, src_suffix, src_account_no: src_acct,
      }));
    }
  }

  // Service-fee rows
  for (const f of (serviceFees || [])) {
    if (!(Number(f.amount) > 0) || !f.account_no) continue;
    rows.push(bodyRow({
      dest_bank: f.bank_code || '088',
      dest_branch: f.branch_code || src_branch,
      dest_suffix: '002',
      dest_account_no: f.account_no,
      amount: f.amount,
      name: f.account_name || f.name,
      description: `${(company.abbreviation || 'AHL').slice(0,8).toUpperCase()} ${yyyymmdd(period.pay_date || period.period_end)}`,
      src_bank, src_branch, src_suffix, src_account_no: src_acct,
    }));
  }

  return [meta, ...rows].join('\n') + '\n';
}

module.exports = { buildBspBatch, splitNet };
