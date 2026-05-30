// NASFund filing CSV.
// NASFund accepts member contribution returns as a spreadsheet. The exact
// template can be downloaded from NASFund's portal; the columns below are
// the standard set used in monthly contribution returns. Submitting as
// CSV (which Excel opens) is accepted. If NASFund updates their template,
// edit COLUMNS below.

function esc(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const COLUMNS = [
  { header: 'Member Number',   value: r => r.employee.nasfund_member_no || '' },
  { header: 'Surname',         value: r => r.employee.last_name },
  { header: 'Given Names',     value: r => r.employee.first_name },
  { header: 'Date of Birth',   value: r => r.employee.dob || '' },
  { header: 'Gross Pay',       value: r => Number(r.gross).toFixed(2) },
  { header: 'Employee 6%',     value: r => Number(r.nasfund).toFixed(2) },
  { header: 'Employer 8.4%',   value: r => Number(r.nasfund_employer || (r.gross*0.084)).toFixed(2) },
  { header: 'Total',           value: r => (Number(r.nasfund) + Number(r.nasfund_employer || r.gross*0.084)).toFixed(2) },
  { header: 'Period',          value: r => r.period_label || '' },
];

function buildNasfundReturn(company, periodLabel, rows) {
  const head = COLUMNS.map(c => esc(c.header)).join(',');
  const body = rows.map(r => COLUMNS.map(c => esc(c.value({ ...r, period_label: periodLabel }))).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

module.exports = { buildNasfundReturn, COLUMNS };
