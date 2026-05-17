#!/usr/bin/env node
// Walk a legacy PNGPay archive (unzipped) and recreate pay periods + their
// original output files in MongoDB.
//
// Usage:
//   node scripts/import_history.js /path/to/PNGPayOnline
//
// Layout expected:
//   PNGPayOnline/
//     <ABBREV>/
//       BSP/
//         <year>/
//           BSPPayroll-YYYYMMDD.csv         (BSP batch — required)
//           GL YYYY-MM-DD.pdf               (general ledger — optional)
//           Pay Slips for YYYYMMDD.pdf      (combined payslips — optional)
//       QB/
//         <year>/                           (QB IIF files — optional)
//         IIFfiles/<year>/                  (alternate QB layout)
//       NASFund Reports/<year>/             (xlsx + pdf returns)
//       NCSL Reports/<year>/                (xlsx + pdf returns)
//
// Each BSPPayroll CSV becomes a pay_period row (status=historical).
// Each row of the CSV becomes a payroll_entry. The amount on the row is
// stored as `net` only — we don't have the original gross/tax breakdown,
// so the engine numbers are deliberately left null for imported periods.
//
// All companion files (GL PDF, Pay Slips PDF, IIF) for the same date go
// into GridFS attached to that period, alongside the original BSP CSV.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initDb, getDb, oid, ObjectId } = require('../src/db');
const periodFiles = require('../src/period_files');

const ABBREV_NAMES = {
  AHL:   'Angore Holdings Limited',
  TTANI: 'T.T Angore Noahai Investment Limited',
  ACAP:  'Angore Community Affairs Project',           // best-guess; rename in Admin if wrong
  ASPA:  'Angore Special Purpose Authority',
  Alua:  'Alua Investments Limited',
};

function parseDate(yyyymmdd) {
  // '20200117' -> '2020-01-17'
  const s = String(yyyymmdd).replace(/-/g, '').slice(0, 8);
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function fortnightStart(iso) {
  // Pay date typically = period_end + a few days. Without a hard rule, mark
  // period_start = pay_date - 13d as a reasonable default for historical rows.
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 13);
  return d.toISOString().slice(0, 10);
}

function parseBspCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return null;
  const head = lines[0].split(',');
  const meta = {
    bsp_marker:   head[0] || '',
    company_name: (head[1] || '').trim(),
    client_no:    (head[2] || '').trim(),
    type:         (head[3] || '').trim(),
    yyyymmdd:     (head[4] || '').trim(),
  };
  const rows = lines.slice(1).map(line => {
    const c = line.split(',');
    return {
      dest_bank:      (c[0] || '').trim(),
      dest_branch:    (c[1] || '').trim(),
      dest_suffix:    (c[2] || '').trim(),
      dest_account:   (c[3] || '').trim(),
      txn_code:       (c[4] || '').trim(),
      amount:         parseFloat((c[5] || '0').replace(/[, ]/g, '')) || 0,
      name:           (c[6] || '').trim(),
      description:    (c[7] || '').trim(),
      src_bank:       (c[8] || '').trim(),
      src_branch:     (c[9] || '').trim(),
      src_suffix:     (c[10] || '').trim(),
      src_account:    (c[11] || '').trim(),
    };
  }).filter(r => r.dest_account && r.amount > 0);
  return { meta, rows };
}

// "AGUAI-ANDAPE" → { last: 'AGUAI', first: 'ANDAPE' }
// "Theresia Bob" → { last: 'Bob', first: 'Theresia' }
// "Aipe-Timbiju " → { last: 'Aipe', first: 'Timbiju' }
function splitName(raw) {
  const s = String(raw || '').trim();
  if (!s) return { first: '', last: '' };
  if (s.includes('-')) {
    const [last, first] = s.split('-').map(x => x.trim());
    return { last: titleCase(last), first: titleCase(first), name_format: 'legacy' };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: titleCase(parts[0]), last: '' };
  // Convention from the 2021 AHL files: First Last (space-separated)
  return { first: titleCase(parts[0]), last: titleCase(parts.slice(1).join(' ')) };
}
function titleCase(s) {
  return String(s || '').toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase());
}

async function ensureCompany(db, abbrev, fallbackName, clientNo) {
  const expected = ABBREV_NAMES[abbrev] || fallbackName || ('Company ' + abbrev);
  let c = await db.collection('companies').findOne({ abbreviation: abbrev });
  if (!c) {
    const r = await db.collection('companies').insertOne({
      name: expected, abbreviation: abbrev,
      pay_interval: 'fortnightly', default_hours: 80,
      currency: 'PGK', is_active: 1,
      bank_code: '088', branch_code: '314', bank_account_suffix: '002',
      bank_client_no: clientNo || null,
      created_at: new Date(),
    });
    c = await db.collection('companies').findOne({ _id: r.insertedId });
  } else if (clientNo && !c.bank_client_no) {
    await db.collection('companies').updateOne({ _id: c._id }, { $set: { bank_client_no: clientNo } });
  }
  return c;
}

// Resolve / create an employee record. Match by (first_name + last_name)
// within a company — the legacy app sometimes shares a destination account
// across employees who don't have their own bank account, so account
// number isn't a reliable identity. Name is.
async function ensureEmployee(db, companyId, row) {
  const accountNo = row.dest_account;
  const { first, last, name_format } = splitName(row.name);
  const fnRe = new RegExp('^' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
  const lnRe = new RegExp('^' + last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
  let e = await db.collection('employees').findOne({
    company_id: companyId,
    first_name: fnRe,
    last_name: lnRe,
  });
  if (e) return e;
  // Description: "AHL SALARY" / "TTANI WAGES" — derive pay_type.
  const pay_type = /WAGES/i.test(row.description) ? 'hourly' : 'salary';
  const insert = {
    company_id: companyId, first_name: first, last_name: last || first,
    pay_type, default_hours: 80, dependents: 0, fte_pct: 100,
    bank_id: null,
    bank_code: row.dest_bank || '088',
    branch_code: row.dest_branch || null,
    bank_account_no: accountNo,
    bank_account_name: row.name,
    bank_accounts: [{
      bank_id: null, branch_code: row.dest_branch || null,
      account_no: accountNo, account_name: row.name, percentage: 100,
    }],
    name_format,
    is_active: 1,
    imported_from_history: true,
    created_at: new Date(),
  };
  const r = await db.collection('employees').insertOne(insert);
  return { _id: r.insertedId, ...insert };
}

// Sibling-file detection for a given date.
function siblingFiles(bspDir, yyyymmdd) {
  if (!fs.existsSync(bspDir)) return [];
  const files = fs.readdirSync(bspDir);
  const iso = parseDate(yyyymmdd);
  return files
    .filter(f => f.endsWith('.pdf') || f.endsWith('.iif'))
    .filter(f => f.includes(yyyymmdd) || (iso && f.includes(iso)))
    .map(f => path.join(bspDir, f));
}

async function importOnePeriod(db, company, bspCsvPath) {
  const text = fs.readFileSync(bspCsvPath, 'utf8');
  const parsed = parseBspCsv(text);
  if (!parsed) { console.warn('  ! could not parse', bspCsvPath); return null; }
  const pay_date = parseDate(parsed.meta.yyyymmdd);
  if (!pay_date) { console.warn('  ! no date in', bspCsvPath); return null; }
  const period_start = fortnightStart(pay_date);
  const period_end   = pay_date;

  // Idempotency: skip if already imported.
  const existing = await db.collection('pay_periods').findOne({
    company_id: company._id, pay_date, status: 'historical',
  });
  if (existing) {
    return { skipped: true, pay_date, entries: 0 };
  }

  const periodRes = await db.collection('pay_periods').insertOne({
    company_id: company._id,
    period_start, period_end, pay_date,
    status: 'historical',
    imported_from: path.basename(bspCsvPath),
    created_at: new Date(),
  });
  const periodId = periodRes.insertedId;

  // Split rows into employee credits vs service-fee credits.
  // In the legacy BSP CSV, employee rows have description like
  // "<ABBREV> SALARY" / "<ABBREV> WAGES". Service-fee rows (Theresia,
  // Richard) instead use "<ABBREV> <YYYYMMDD>" — date in the description
  // is the marker.
  const dateMarker = /\b\d{8}\b/;
  const employeeRows = [];
  const feeRows = [];
  for (const row of parsed.rows) {
    if (dateMarker.test(row.description || '')) feeRows.push(row);
    else employeeRows.push(row);
  }

  // Group employee rows by name. An employee with multiple bank accounts
  // appears as multiple rows; they collapse into one payroll_entry.
  const empBuckets = new Map();   // key = normalised name → { rows, totalAmount }
  function nameKey(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }
  for (const row of employeeRows) {
    const key = nameKey(row.name);
    if (!empBuckets.has(key)) empBuckets.set(key, { rows: [], total: 0 });
    const b = empBuckets.get(key);
    b.rows.push(row); b.total += row.amount;
  }

  // Roll up service fees onto the pay_period for audit/storage.
  if (feeRows.length) {
    const serviceFees = feeRows.map(r => ({
      name: r.name,
      amount: +r.amount.toFixed(2),
      account_name: r.name,
      account_no: r.dest_account,
      branch_code: r.dest_branch,
      bank_code: r.dest_bank,
      description: r.description,
    }));
    await db.collection('pay_periods').updateOne({ _id: periodId },
      { $set: { service_fees: serviceFees } });
  }

  let entriesCount = 0;
  let totalNet = 0;
  for (const [, bucket] of empBuckets) {
    const primaryRow = bucket.rows[0];
    const emp = await ensureEmployee(db, company._id, primaryRow);

    // If the employee has >1 account in this CSV, store the full split on
    // their employee record so future runs use the same allocation.
    if (bucket.rows.length > 1) {
      const total = bucket.total;
      const bank_accounts = bucket.rows.map(r => ({
        bank_id: null, branch_code: r.dest_branch || null,
        account_no: r.dest_account, account_name: r.name,
        percentage: +(100 * r.amount / total).toFixed(4),
      }));
      await db.collection('employees').updateOne({ _id: emp._id }, { $set: { bank_accounts } });
    }

    await db.collection('payroll_entries').insertOne({
      pay_period_id: periodId,
      employee_id: emp._id,
      hours: null, cash_advance: 0, note: null,
      gross: null, tax: null, nasfund: null, other_deductions: null,
      net: +bucket.total.toFixed(2),
      calc_breakdown: null,
      imported_from_history: true,
      imported_rows: bucket.rows.length,
    });
    entriesCount++;
    totalNet += bucket.total;
  }
  await db.collection('pay_periods').updateOne({ _id: periodId },
    { $set: { total_net_imported: +totalNet.toFixed(2) } });

  // Store the original BSP CSV + companion files (GL, Pay Slips, IIF) in GridFS.
  const yyyymmdd = parsed.meta.yyyymmdd;
  await periodFiles.storeExternal({
    pay_period_id: periodId, company_id: company._id,
    kind: 'bsp_original',
    filename: path.basename(bspCsvPath),
    contentType: 'text/csv',
    buffer: Buffer.from(text),
  });
  const bspDir = path.dirname(bspCsvPath);
  for (const sibling of siblingFiles(bspDir, yyyymmdd)) {
    const kind = sibling.toLowerCase().includes('pay slips') ? 'payslips_combined'
               : sibling.toLowerCase().includes('gl ')      ? 'gl_pdf'
               : sibling.toLowerCase().endsWith('.iif')      ? 'qb_iif'
               :                                              'historical_other';
    await periodFiles.storeExternal({
      pay_period_id: periodId, company_id: company._id,
      kind,
      filename: path.basename(sibling),
      contentType: sibling.endsWith('.pdf') ? 'application/pdf'
                  : sibling.endsWith('.iif') ? 'text/plain'
                  : 'application/octet-stream',
      buffer: fs.readFileSync(sibling),
    });
  }
  return { skipped: false, pay_date, entries: entriesCount, totalNet };
}

async function main() {
  const root = process.argv[2];
  if (!root) {
    console.error('Usage: node scripts/import_history.js /path/to/PNGPayOnline');
    process.exit(2);
  }
  if (!fs.existsSync(root)) {
    console.error('Path does not exist:', root);
    process.exit(2);
  }

  await initDb();
  const db = getDb();

  const companies = fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);
  let totalPeriods = 0, totalEntries = 0, totalSkipped = 0;
  for (const abbrev of companies) {
    const cdir = path.join(root, abbrev);
    const bspDir = path.join(cdir, 'BSP');
    if (!fs.existsSync(bspDir)) {
      console.log(`(no BSP dir under ${abbrev}, skipping)`);
      continue;
    }
    const company = await ensureCompany(db, abbrev, null, null);
    console.log(`\n=== ${abbrev}  →  ${company.name} (id ${company._id}) ===`);
    const years = fs.readdirSync(bspDir, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    for (const yr of years) {
      const ydir = path.join(bspDir, yr);
      const csvs = fs.readdirSync(ydir).filter(f => /^BSPPayroll-\d{8}.*\.csv$/i.test(f));
      for (const csv of csvs) {
        const csvPath = path.join(ydir, csv);
        process.stdout.write(`  · ${csv} ... `);
        const r = await importOnePeriod(db, company, csvPath);
        if (!r) { console.log('SKIP'); continue; }
        if (r.skipped) { console.log('already imported'); totalSkipped++; continue; }
        console.log(`${r.entries} entries, net K${r.totalNet.toFixed(2)}`);
        totalPeriods++;
        totalEntries += r.entries;
      }
    }
  }

  console.log(`\nImport complete. ${totalPeriods} periods imported, ${totalEntries} entries, ${totalSkipped} skipped.`);
  process.exit(0);
}

// Always run main if argv[1] resolves to this file (so the in-memory wrapper
// can trigger it via require()).
if (require.main === module || (process.argv[1] && process.argv[1].endsWith('import_history.js'))) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { parseBspCsv, splitName, parseDate };
