const express = require('express');
const router = express.Router();
const { getDb, oid, shapeId, shapeMany, withBankAccounts } = require('../src/db');
const { calculate, DEFAULT_PNG_RULES } = require('../src/payroll');
const { buildCsv } = require('../src/csv');
const { buildBspBatch } = require('../src/bsp');
const { sendPayStub, sendCsvToAdmin } = require('../src/email');
const periodFiles = require('../src/period_files');

const BASE = process.env.BASE_PATH || '';

function getCompanyId(req) {
  // system_owner / principal / bookkeeper can pick a company.
  if (req.user.clearance_level >= 2) {
    return oid(req.query.company || req.body.company_id);
  }
  // site_payroll is locked to their assigned company.
  return oid(req.user.company_id);
}

async function getActiveRules(db, companyId) {
  const row = await db.collection('tax_rules')
    .find({ company_id: oid(companyId) })
    .sort({ effective_from: -1, _id: -1 })
    .limit(1).toArray();
  return row.length ? (typeof row[0].data === 'string' ? JSON.parse(row[0].data) : row[0].data) : DEFAULT_PNG_RULES;
}

router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const companyId = getCompanyId(req);
    let periods = [];
    if (companyId) {
      const docs = await db.collection('pay_periods')
        .find({ company_id: companyId })
        .sort({ period_start: -1 })
        .limit(50).toArray();
      // count entries per period
      for (const p of docs) {
        p.n_entries = await db.collection('payroll_entries').countDocuments({ pay_period_id: p._id });
      }
      periods = shapeMany(docs);
    }
    const companies = req.user.role === 'super_admin'
      ? shapeMany(await db.collection('companies').find({}).sort({ name: 1 }).toArray()) : [];
    res.render('payroll/history', {
      title: 'Payroll', periods, companyId: companyId ? companyId.toString() : null, companies,
    });
  } catch (e) { next(e); }
});

router.get('/new', async (req, res, next) => {
  try {
    const db = getDb();
    const companyId = getCompanyId(req);
    if (!companyId) return res.redirect(BASE + '/payroll');
    const company = shapeId(await db.collection('companies').findOne({ _id: companyId }));
    const employees = shapeMany(await db.collection('employees')
      .find({ company_id: companyId, is_active: 1 })
      .sort({ last_name: 1, first_name: 1 })
      .toArray());
    // resolve dept names
    const deptIds = [...new Set(employees.filter(e => e.department_id).map(e => e.department_id.toString()))];
    const depts = deptIds.length
      ? await db.collection('departments').find({ _id: { $in: deptIds.map(oid) } }).toArray() : [];
    const dMap = Object.fromEntries(depts.map(d => [d._id.toString(), d.name]));
    employees.forEach(e => { e.dept_name = e.department_id ? dMap[e.department_id.toString()] : null; });
    res.render('payroll/new', { title: 'New pay period', company, employees });
  } catch (e) { next(e); }
});

// Stage 1: site payroll_admin submits hours; period saved as pending_approval.
// Stage 2: company_admin or super_admin approves; that's when emails/BSP fire.
router.post('/confirm', async (req, res, next) => {
  try {
    const db = getDb();
    const companyId = getCompanyId(req);

    const period_start = req.body.period_start;
    const period_end   = req.body.period_end;
    const pay_date     = req.body.pay_date;

    const entriesIn = Array.isArray(req.body.entries) ? req.body.entries : Object.values(req.body.entries || {});

    // What state should this end up in?
    // - super_admin or company_admin saving = pending_approval, ready to approve in 1 click
    // - payroll_admin saving = pending_approval (the approver is someone else)
    // No-one short-circuits to 'approved' on save — approval is its own action.
    const initialStatus = 'pending_approval';

    const periodInsert = await db.collection('pay_periods').insertOne({
      company_id: companyId,
      period_start, period_end, pay_date,
      status: initialStatus,
      created_by: oid(req.user.id),
      created_at: new Date(),
      submitted_at: new Date(),
    });
    const periodId = periodInsert.insertedId;

    // Persist each line + run calculation now (so approver sees the numbers).
    const rules = await getActiveRules(db, companyId);
    const company = shapeId(await db.collection('companies').findOne({ _id: companyId }));
    for (const e of entriesIn) {
      const employee = await db.collection('employees').findOne({ _id: oid(e.employee_id) });
      if (!employee || employee.company_id.toString() !== companyId.toString()) continue;
      const hours = parseFloat(e.hours || '0');
      const cash_advance = parseFloat(e.cash_advance || '0');
      const note = (e.note || '').slice(0, 1000);
      const r = calculate(employee, { hours, cash_advance }, rules, company);
      await db.collection('payroll_entries').insertOne({
        pay_period_id: periodId,
        employee_id: employee._id,
        hours, cash_advance, note,
        gross: r.gross, tax: r.tax, nasfund: r.nasfund,
        other_deductions: r.other_deductions, net: r.net,
        calc_breakdown: r.breakdown,
      });
    }

    req.session.flash = { type: 'success', text:
      'Payroll saved as pending approval. Pay stubs will go out once it is approved.' };
    res.redirect(BASE + `/payroll/${periodId.toString()}`);
  } catch (e) { next(e); }
});

// Approval endpoint — only company_admin or super_admin can hit it.
router.post('/:id/approve', async (req, res, next) => {
  try {
    // Bookkeeper+ can approve.
    if (req.user.clearance_level < 2) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Only an approver can approve a payroll run.' });
    }
    const db = getDb();
    const period = await db.collection('pay_periods').findOne({ _id: oid(req.params.id) });
    if (!period) return res.status(404).render('error', { title: 'Not found', message: 'Period not found.' });
    if (req.user.role !== 'super_admin' && period.company_id.toString() !== req.user.company_id.toString()) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'No access.' });
    }
    if (period.status === 'approved') {
      req.session.flash = { type: 'warn', text: 'Already approved.' };
      return res.redirect(BASE + '/payroll/' + period._id.toString());
    }

    const company = shapeId(await db.collection('companies').findOne({ _id: period.company_id }));
    const entries = await db.collection('payroll_entries').find({ pay_period_id: period._id }).toArray();
    const empIds = entries.map(e => e.employee_id);
    const emps = await db.collection('employees').find({ _id: { $in: empIds } }).toArray();
    const empMap = Object.fromEntries(emps.map(e => [e._id.toString(), e]));

    const results = entries.map(e => {
      const emp = empMap[e.employee_id.toString()] || {};
      return {
        employee: emp, hours: e.hours, cash_advance: e.cash_advance, note: e.note,
        gross: e.gross, tax: e.tax, nasfund: e.nasfund,
        other_deductions: e.other_deductions, net: e.net, breakdown: e.calc_breakdown,
      };
    });

    // Service-fee rows (Theresia 3%, Richard 2%, etc.) — computed against the
    // total gross paid in this run. Stored on the period for audit and added
    // to the BSP batch automatically.
    const totalGross = results.reduce((s, r) => s + (Number(r.gross) || 0), 0);
    const fees = await db.collection('service_fees').find({ is_active: 1 }).toArray();
    const serviceFeeRows = fees.map(f => ({
      name: f.name,
      pct: f.pct_of_gross,
      amount: +(totalGross * (Number(f.pct_of_gross) || 0) / 100).toFixed(2),
      bank_id: f.bank_id, branch_code: f.branch_code,
      account_no: f.account_no, account_name: f.account_name,
    }));

    await db.collection('pay_periods').updateOne(
      { _id: period._id },
      { $set: {
          status: 'approved',
          approved_by: oid(req.user.id),
          approved_at: new Date(),
          total_gross: totalGross,
          service_fees: serviceFeeRows,
        } }
    );

    // Pull bank_accounts shape onto each row's employee for the BSP/PDF builders.
    const { withBankAccounts: _wba } = require('../src/db');
    results.forEach(r => { r.employee = _wba(r.employee); });

    // Now the email + CSV pipeline.
    const csv = buildCsv(company, results, period);
    const emailErrors = [];
    for (const row of results) {
      if (row.employee.email) {
        try { await sendPayStub({ company, period, ...row }); }
        catch (err) { emailErrors.push(`${row.employee.email}: ${err.message}`); }
      }
    }
    try { await sendCsvToAdmin({ company, csv, period }); }
    catch (err) { emailErrors.push(`csv-admin: ${err.message}`); }

    // Generate + store the file set (BSP CSV, summary CSV, per-employee PDFs) in GridFS.
    try {
      const periodFresh = await db.collection('pay_periods').findOne({ _id: period._id });
      await periodFiles.generateAll(company, periodFresh, results);
    } catch (err) { emailErrors.push(`file-store: ${err.message}`); }

    req.session.flash = {
      type: emailErrors.length ? 'warn' : 'success',
      text: emailErrors.length
        ? `Approved. ${results.length} stubs processed. Email issues: ${emailErrors.join('; ')}`
        : `Approved. ${results.length} stubs sent. Service fees: ${serviceFeeRows.map(f=>`${f.name} ${f.amount}`).join(', ') || '(none configured)'}.`,
    };
    res.redirect(BASE + '/payroll/' + period._id.toString());
  } catch (e) { next(e); }
});

// Reject (send back to draft for edits)
router.post('/:id/reject', async (req, res, next) => {
  try {
    if (req.user.clearance_level < 2) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Only an approver can reject.' });
    }
    const db = getDb();
    await db.collection('pay_periods').updateOne(
      { _id: oid(req.params.id) },
      { $set: { status: 'draft', rejection_reason: req.body.reason || null } }
    );
    req.session.flash = { type: 'warn', text: 'Sent back as draft.' };
    res.redirect(BASE + '/payroll/' + req.params.id);
  } catch (e) { next(e); }
});

// Download a stored file from a pay period (BSP, summary, payslip PDFs).
router.get('/files/:fileId', async (req, res, next) => {
  try {
    const meta = await periodFiles.getFileMeta(req.params.fileId);
    if (!meta) return res.status(404).send('Not found');
    // Authorisation: scope by company; reject if user can't see this company.
    if (req.user.clearance_level < 3) {
      const companyId = meta.metadata && meta.metadata.company_id;
      if (!companyId || (req.user.company_id && companyId.toString() !== req.user.company_id.toString())) {
        return res.status(403).send('Forbidden');
      }
    }
    res.setHeader('Content-Type', meta.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${meta.filename}"`);
    periodFiles.openDownload(req.params.fileId).pipe(res);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const period = await db.collection('pay_periods').findOne({ _id: oid(req.params.id) });
    if (!period) return res.status(404).render('error', { title: 'Not found', message: 'Period not found.' });
    if (req.user.role !== 'super_admin' && period.company_id.toString() !== req.user.company_id.toString()) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'No access.' });
    }
    const company = shapeId(await db.collection('companies').findOne({ _id: period.company_id }));
    const entries = await db.collection('payroll_entries').find({ pay_period_id: period._id }).toArray();

    const empIds = entries.map(e => e.employee_id);
    const emps = await db.collection('employees').find({ _id: { $in: empIds } }).toArray();
    const empMap = Object.fromEntries(emps.map(e => [e._id.toString(), e]));
    const deptIds = [...new Set(emps.filter(e => e.department_id).map(e => e.department_id.toString()))];
    const depts = deptIds.length
      ? await db.collection('departments').find({ _id: { $in: deptIds.map(oid) } }).toArray() : [];
    const dMap = Object.fromEntries(depts.map(d => [d._id.toString(), d.name]));

    const rows = entries.map(e => {
      const emp = empMap[e.employee_id.toString()] || {};
      return {
        ...e,
        first_name: emp.first_name, last_name: emp.last_name, email: emp.email,
        dept_name: emp.department_id ? dMap[emp.department_id.toString()] : null,
      };
    });
    const files = await periodFiles.listForPeriod(period._id);
    res.render('payroll/period', {
      title: `Payroll ${period.period_start} - ${period.period_end}`,
      period: shapeId(period), entries: rows, company, files,
    });
  } catch (e) { next(e); }
});

router.get('/:id/csv', async (req, res, next) => {
  try {
    const db = getDb();
    const period = await db.collection('pay_periods').findOne({ _id: oid(req.params.id) });
    if (!period) return res.status(404).send('Not found');
    if (req.user.role !== 'super_admin' && period.company_id.toString() !== req.user.company_id.toString()) {
      return res.status(403).send('Forbidden');
    }
    const company = shapeId(await db.collection('companies').findOne({ _id: period.company_id }));
    const entries = await db.collection('payroll_entries').find({ pay_period_id: period._id }).toArray();
    const empIds = entries.map(e => e.employee_id);
    const emps = await db.collection('employees').find({ _id: { $in: empIds } }).toArray();
    const empMap = Object.fromEntries(emps.map(e => [e._id.toString(), e]));
    const bankIds = [...new Set(emps.filter(e => e.bank_id).map(e => e.bank_id.toString()))];
    const banks = bankIds.length
      ? await db.collection('banks').find({ _id: { $in: bankIds.map(oid) } }).toArray() : [];
    const bMap = Object.fromEntries(banks.map(b => [b._id.toString(), b]));

    const rows = entries.map(e => {
      const emp = empMap[e.employee_id.toString()] || {};
      return {
        employee: {
          ...emp,
          bank_name: emp.bank_id && bMap[emp.bank_id.toString()] ? bMap[emp.bank_id.toString()].name : null,
        },
        hours: e.hours, cash_advance: e.cash_advance, note: e.note,
        gross: e.gross, tax: e.tax, nasfund: e.nasfund,
        other_deductions: e.other_deductions, net: e.net,
      };
    });
    const csv = buildCsv(company, rows, period);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition',
      `attachment; filename="${company.abbreviation || 'payroll'}-${period.period_start}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

router.get('/:id/bsp', async (req, res, next) => {
  try {
    const db = getDb();
    const period = await db.collection('pay_periods').findOne({ _id: oid(req.params.id) });
    if (!period) return res.status(404).send('Not found');
    if (req.user.role !== 'super_admin' && period.company_id.toString() !== req.user.company_id.toString()) {
      return res.status(403).send('Forbidden');
    }
    const company = shapeId(await db.collection('companies').findOne({ _id: period.company_id }));
    const entries = await db.collection('payroll_entries').find({ pay_period_id: period._id }).toArray();
    const empIds = entries.map(e => e.employee_id);
    const emps = await db.collection('employees').find({ _id: { $in: empIds } }).toArray();
    const empMap = Object.fromEntries(emps.map(e => [e._id.toString(), e]));

    const rows = entries.map(e => {
      const emp = withBankAccounts(empMap[e.employee_id.toString()] || {});
      return { employee: emp, entry: e };
    });
    const batch = buildBspBatch(company, period, rows, period.service_fees || []);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition',
      `attachment; filename="${(company.abbreviation || 'BSP')}-${period.period_start}-batch.csv"`);
    res.send(batch);
  } catch (e) { next(e); }
});

module.exports = router;
