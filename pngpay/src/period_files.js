// Per-period file storage in MongoDB GridFS.
//
// On payroll approval we generate:
//   * `bsp-<company>-<period_start>.csv`  — the bank batch upload
//   * `summary-<company>-<period_start>.csv` — full payroll register
//   * `payslip-<lastname>-<firstname>-<period_start>.pdf` — one per employee
//
// On demand (Admin → NASFund) we also store:
//   * `nasfund-<company>-<period_start>.csv`
//
// All files live in a single GridFS bucket "period_files" and are tagged in
// metadata with { pay_period_id, company_id, kind, employee_id? } so the
// period page can list them and the back-history importer can attach the
// originals received from the user's Drive folder.
const { GridFSBucket } = require('mongodb');
const { getDb, oid } = require('./db');
const { buildCsv } = require('./csv');
const { buildBspBatch } = require('./bsp');
const { buildPayStubPdf } = require('./pdf_stub');

function getBucket() { return new GridFSBucket(getDb(), { bucketName: 'period_files' }); }

function safeName(s) { return String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 64); }

// Upload a Buffer into GridFS with the given filename + metadata.
function storeBuffer(bucket, filename, contentType, metadata, buffer) {
  return new Promise((resolve, reject) => {
    const up = bucket.openUploadStream(filename, { contentType, metadata });
    up.on('finish', () => resolve(up.id));
    up.on('error', reject);
    up.end(buffer);
  });
}

// Remove any previously-stored files for a (period, kind[, employee]).
// Used so re-running generation doesn't accumulate duplicates.
async function removeExisting(bucket, match) {
  const files = await bucket.find(match).toArray();
  for (const f of files) await bucket.delete(f._id);
}

// Generate + store the full file set for an approved pay period.
//   rows: [{ employee, hours, cash_advance, note, gross, tax, nasfund,
//             other_deductions, net, breakdown }]
async function generateAll(company, period, rows) {
  const bucket = getBucket();
  const pid = period._id || period.id;
  const cid = company._id || company.id;
  const stamp = period.period_start || new Date().toISOString().slice(0, 10);
  const abbrev = safeName(company.abbreviation || company.name || 'company');

  // Clear prior versions of these auto-files (NASFund kept; it's generated separately).
  await removeExisting(bucket, {
    'metadata.pay_period_id': pid,
    'metadata.kind': { $in: ['bsp', 'summary', 'payslip'] },
  });

  // BSP batch (includes service-fee rows + multi-bank split)
  const bspCsv = buildBspBatch(company, period, rows.map(r => ({ employee: r.employee, entry: { net: r.net } })), period.service_fees || []);
  await storeBuffer(bucket, `bsp-${abbrev}-${stamp}.csv`, 'text/csv',
    { pay_period_id: pid, company_id: cid, kind: 'bsp', period_start: stamp }, Buffer.from(bspCsv));

  // Summary register CSV (the same shape we email to admins)
  const summaryCsv = buildCsv(company, rows, period);
  await storeBuffer(bucket, `summary-${abbrev}-${stamp}.csv`, 'text/csv',
    { pay_period_id: pid, company_id: cid, kind: 'summary', period_start: stamp }, Buffer.from(summaryCsv));

  // Per-employee payslip PDFs
  for (const r of rows) {
    const pdf = await buildPayStubPdf({ company, period, ...r });
    const name = `payslip-${safeName(r.employee.last_name)}-${safeName(r.employee.first_name)}-${stamp}.pdf`;
    await storeBuffer(bucket, name, 'application/pdf', {
      pay_period_id: pid, company_id: cid, kind: 'payslip',
      employee_id: r.employee._id || r.employee.id,
      period_start: stamp,
    }, pdf);
  }
}

async function listForPeriod(periodId) {
  const bucket = getBucket();
  const files = await bucket.find({ 'metadata.pay_period_id': oid(periodId) })
    .sort({ 'metadata.kind': 1, filename: 1 })
    .toArray();
  return files.map(f => ({
    id: f._id.toString(),
    filename: f.filename,
    kind: f.metadata && f.metadata.kind,
    employee_id: f.metadata && f.metadata.employee_id ? f.metadata.employee_id.toString() : null,
    length: f.length,
    contentType: f.contentType,
    uploadDate: f.uploadDate,
  }));
}

function openDownload(fileId) {
  return getBucket().openDownloadStream(oid(fileId));
}

async function getFileMeta(fileId) {
  const files = await getBucket().find({ _id: oid(fileId) }).toArray();
  return files[0] || null;
}

// Store a single externally-supplied file (used by the back-history importer).
async function storeExternal({ pay_period_id, company_id, kind, filename, contentType, buffer, employee_id }) {
  const bucket = getBucket();
  return storeBuffer(bucket, filename, contentType,
    { pay_period_id: oid(pay_period_id), company_id: oid(company_id), kind, employee_id: employee_id ? oid(employee_id) : null, imported: true },
    buffer);
}

module.exports = { generateAll, listForPeriod, openDownload, getFileMeta, storeExternal };
