// CSV export.
// Richard: edit `COLUMNS` below to change what gets exported each pay run.
// Each column is { header, value(row) }. `row` is { employee, hours, cash_advance,
// note, gross, tax, nasfund, other_deductions, net }.

function esc(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const COLUMNS = [
  { header: 'employee_id',       value: r => r.employee.id },
  { header: 'first_name',        value: r => r.employee.first_name },
  { header: 'last_name',         value: r => r.employee.last_name },
  { header: 'email',             value: r => r.employee.email || '' },
  { header: 'bank',              value: r => r.employee.bank_name || '' },
  { header: 'bank_account_no',   value: r => r.employee.bank_account_no || '' },
  { header: 'bank_account_name', value: r => r.employee.bank_account_name || '' },
  { header: 'hours',             value: r => r.hours },
  { header: 'gross',             value: r => r.gross.toFixed(2) },
  { header: 'tax',               value: r => r.tax.toFixed(2) },
  { header: 'nasfund',           value: r => r.nasfund.toFixed(2) },
  { header: 'other_deductions',  value: r => r.other_deductions.toFixed(2) },
  { header: 'cash_advance',      value: r => Number(r.cash_advance || 0).toFixed(2) },
  { header: 'net',               value: r => r.net.toFixed(2) },
  { header: 'note',              value: r => r.note || '' },
];

function buildCsv(company, rows, period) {
  const head = COLUMNS.map(c => esc(c.header)).join(',');
  const body = rows.map(r => COLUMNS.map(c => esc(c.value(r))).join(',')).join('\n');
  // Header line above the data with company + period context (commented out by default).
  // const meta = `# ${company.name} payroll ${period.period_start}..${period.period_end} (pay date ${period.pay_date})\n`;
  return head + '\n' + body + '\n';
}

module.exports = { buildCsv, COLUMNS };
