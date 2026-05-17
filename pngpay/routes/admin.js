const express = require('express');
const router = express.Router();
const { getDb, oid, shapeId, shapeMany } = require('../src/db');
const { hashPassword, clearanceOf, normalizeRole } = require('../src/auth');
const { DEFAULT_PNG_RULES } = require('../src/payroll');
const { buildNasfundReturn } = require('../src/nasfund');
const { importEmployeesCsv } = require('../src/import_employees');

const BASE = process.env.BASE_PATH || '';

// Inside the admin section, service fees are owner-only.
function requireOwner(req, res, next) {
  if (req.user.clearance_level < 4) {
    return res.status(403).render('error', {
      title: 'Owner-only', message: 'Only the system owner can manage service fees.' });
  }
  next();
}

router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const companies = shapeMany(await db.collection('companies').find({}).sort({ name: 1 }).toArray());
    const users = shapeMany(await db.collection('users').find({}).sort({ email: 1 }).toArray());
    const cMap = Object.fromEntries(companies.map(c => [c.id, c.name]));
    users.forEach(u => { u.company_name = u.company_id ? cMap[u.company_id.toString()] : null; });
    const serviceFees = shapeMany(await db.collection('service_fees').find({}).sort({ pct_of_gross: -1 }).toArray());
    res.render('admin/index', { title: 'Admin', companies, users, serviceFees });
  } catch (e) { next(e); }
});

// Service fees (Theresia 3%, Richard 2%, etc.) — owner-only.
router.post('/service-fees/new', requireOwner, async (req, res, next) => {
  try {
    const db = getDb();
    await db.collection('service_fees').insertOne({
      name: req.body.name,
      pct_of_gross: parseFloat(req.body.pct_of_gross) || 0,
      bank_id: req.body.bank_id ? oid(req.body.bank_id) : null,
      bank_code: req.body.bank_code || '088',
      branch_code: req.body.branch_code || null,
      account_no: req.body.account_no || null,
      account_name: req.body.account_name || null,
      is_active: 1,
      created_at: new Date(),
    });
    req.session.flash = { type: 'success', text: 'Service fee recipient added.' };
    res.redirect(BASE + '/admin');
  } catch (e) { next(e); }
});

router.post('/service-fees/:id/delete', requireOwner, async (req, res, next) => {
  try {
    await getDb().collection('service_fees').deleteOne({ _id: oid(req.params.id) });
    res.redirect(BASE + '/admin');
  } catch (e) { next(e); }
});

router.post('/companies/new', async (req, res, next) => {
  try {
    const db = getDb();
    const r = await db.collection('companies').insertOne({
      name: req.body.name, abbreviation: req.body.abbreviation || null,
      pay_interval: req.body.pay_interval || 'fortnightly',
      default_hours: parseFloat(req.body.default_hours || '80'),
      currency: 'PGK', is_active: 1, created_at: new Date(),
    });
    await db.collection('tax_rules').insertOne({
      company_id: r.insertedId, effective_from: new Date().toISOString().slice(0, 10),
      data: DEFAULT_PNG_RULES, notes: 'Initial defaults', created_at: new Date(),
    });
    req.session.flash = { type: 'success', text: 'Company created with default PNG tax rules.' };
    res.redirect(BASE + '/admin');
  } catch (e) { next(e); }
});

router.get('/companies/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const company = shapeId(await db.collection('companies').findOne({ _id: oid(req.params.id) }));
    if (!company) return res.status(404).render('error', { title: 'Not found', message: 'Company not found.' });
    res.render('admin/company', { title: company.name, company });
  } catch (e) { next(e); }
});

router.post('/companies/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const b = req.body;
    await db.collection('companies').updateOne({ _id: oid(req.params.id) }, { $set: {
      name: b.name, abbreviation: b.abbreviation || null,
      pay_interval: b.pay_interval || 'fortnightly',
      default_hours: parseFloat(b.default_hours || '80'),
      currency: b.currency || 'PGK', is_active: b.is_active ? 1 : 0,
      bank_account_name: b.bank_account_name || null,
      bank_code: b.bank_code || null, branch_code: b.branch_code || null,
      bank_account_no: b.bank_account_no || null, bank_client_no: b.bank_client_no || null,
      office_email: b.office_email || null,
      payroll_officer_name: b.payroll_officer_name || null,
      payroll_officer_title: b.payroll_officer_title || null,
      email_payslips: b.email_payslips ? 1 : 0,
      cc_office: b.cc_office ? 1 : 0,
      payslip_message: b.payslip_message || null,
      ncsl_employer_no: b.ncsl_employer_no || null,
      ncsl_date_of_reg: b.ncsl_date_of_reg || null,
      manager_email: b.manager_email || null,
      manager_title: b.manager_title || null,
    } });
    req.session.flash = { type: 'success', text: 'Company information updated.' };
    res.redirect(BASE + '/admin/companies/' + req.params.id);
  } catch (e) { next(e); }
});

router.post('/users/new', async (req, res, next) => {
  try {
    const db = getDb();
    const role = normalizeRole(req.body.role);
    // Principal can't promote anyone to her own level or above.
    if (clearanceOf(role) >= req.user.clearance_level && req.user.clearance_level < 4) {
      return res.status(403).render('error', { title: 'Forbidden',
        message: `Only the system owner can create users at level ${clearanceOf(role)} or above.` });
    }
    const password_hash = await hashPassword(req.body.password);
    await db.collection('users').insertOne({
      email: req.body.email.toLowerCase(),
      password_hash, role,
      company_id: req.body.company_id ? oid(req.body.company_id) : null,
      is_active: 1, created_at: new Date(),
    });
    req.session.flash = { type: 'success', text: 'User created.' };
    res.redirect(BASE + '/admin');
  } catch (e) { next(e); }
});

router.get('/import', async (req, res, next) => {
  try {
    const db = getDb();
    const companies = shapeMany(await db.collection('companies').find({}).sort({ name: 1 }).toArray());
    res.render('admin/import', { title: 'Import employees', companies, result: null });
  } catch (e) { next(e); }
});

router.post('/import', async (req, res, next) => {
  try {
    const csvText = typeof req.body === 'string' ? req.body : (req.body.csv || '');
    const result = await importEmployeesCsv(csvText);
    const db = getDb();
    const companies = shapeMany(await db.collection('companies').find({}).sort({ name: 1 }).toArray());
    res.render('admin/import', { title: 'Import employees', companies, result });
  } catch (e) { next(e); }
});

router.get('/nasfund/:periodId', async (req, res, next) => {
  try {
    const db = getDb();
    const period = await db.collection('pay_periods').findOne({ _id: oid(req.params.periodId) });
    if (!period) return res.status(404).send('Not found');
    const company = shapeId(await db.collection('companies').findOne({ _id: period.company_id }));
    const entries = await db.collection('payroll_entries').find({ pay_period_id: period._id }).toArray();
    const empIds = entries.map(e => e.employee_id);
    const emps = await db.collection('employees').find({ _id: { $in: empIds } }).toArray();
    const empMap = Object.fromEntries(emps.map(e => [e._id.toString(), e]));
    const rows = entries.map(e => {
      const emp = empMap[e.employee_id.toString()] || {};
      return { employee: emp, gross: e.gross, nasfund: e.nasfund };
    });
    const csv = buildNasfundReturn(company, `${period.period_start}..${period.period_end}`, rows);
    const filename = `nasfund-${(company.abbreviation || company.name).replace(/\W+/g, '_')}-${period.period_start}.csv`;

    // Cache the generated file in GridFS for this period.
    try {
      const periodFiles = require('../src/period_files');
      await periodFiles.storeExternal({
        pay_period_id: period._id, company_id: period.company_id, kind: 'nasfund',
        filename, contentType: 'text/csv', buffer: Buffer.from(csv),
      });
    } catch (_e) { /* don't fail the download if storage fails */ }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e) { next(e); }
});

module.exports = router;
