const express = require('express');
const router = express.Router();
const { getDb, oid, shapeId, shapeMany, withBankAccounts } = require('../src/db');

const BASE = process.env.BASE_PATH || '';

function scopedCompanyId(req) {
  // system_owner and principal can switch between companies.
  if (req.user.clearance_level >= 3) {
    return oid(req.query.company || req.body.company_id);
  }
  return oid(req.user.company_id);
}

// Apply the "you can't see records at or above your own level" rule.
// Employee records carry a clearance_level (default 0); a user can see
// records with clearance_level < their own.
function clearanceFilter(req) {
  return { clearance_level: { $lt: req.user.clearance_level } };
}

async function withLookups(db, employees) {
  // Resolve dept / job / bank names in one batch each.
  const deptIds = [...new Set(employees.filter(e => e.department_id).map(e => e.department_id.toString()))];
  const jobIds  = [...new Set(employees.filter(e => e.job_function_id).map(e => e.job_function_id.toString()))];
  const bankIds = [...new Set(employees.filter(e => e.bank_id).map(e => e.bank_id.toString()))];
  const [depts, jobs, banks] = await Promise.all([
    deptIds.length ? db.collection('departments').find({ _id: { $in: deptIds.map(oid) } }).toArray() : [],
    jobIds.length  ? db.collection('job_functions').find({ _id: { $in: jobIds.map(oid) } }).toArray() : [],
    bankIds.length ? db.collection('banks').find({ _id: { $in: bankIds.map(oid) } }).toArray() : [],
  ]);
  const ix = (arr) => Object.fromEntries(arr.map(x => [x._id.toString(), x]));
  const dMap = ix(depts), jMap = ix(jobs), bMap = ix(banks);
  return employees.map(e => ({
    ...shapeId(e),
    dept_name: e.department_id && dMap[e.department_id.toString()] ? dMap[e.department_id.toString()].name : null,
    job_name:  e.job_function_id && jMap[e.job_function_id.toString()] ? jMap[e.job_function_id.toString()].name : null,
    bank_name: e.bank_id && bMap[e.bank_id.toString()] ? bMap[e.bank_id.toString()].name : null,
  }));
}

router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const companyId = scopedCompanyId(req);
    let employees = [];
    if (companyId) {
      const docs = await db.collection('employees')
        .find({ company_id: companyId, ...clearanceFilter(req) })
        .sort({ is_active: -1, last_name: 1, first_name: 1 })
        .toArray();
      employees = await withLookups(db, docs);
    }
    const companies = req.user.clearance_level >= 3
      ? shapeMany(await db.collection('companies').find({}).sort({ name: 1 }).toArray())
      : [];
    res.render('employees/list', {
      title: 'Employees', employees,
      companyId: companyId ? companyId.toString() : null,
      companies,
    });
  } catch (e) { next(e); }
});

router.get('/new', (req, res, next) => renderForm(req, res, null).catch(next));
router.get('/:id/edit', async (req, res, next) => {
  try {
    const db = getDb();
    const emp = await db.collection('employees').findOne({ _id: oid(req.params.id) });
    if (!emp) return res.status(404).render('error', { title: 'Not found', message: 'Employee not found.' });
    if (req.user.clearance_level < 3 && emp.company_id.toString() !== req.user.company_id.toString()) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'No access.' });
    }
    if ((emp.clearance_level || 0) >= req.user.clearance_level) {
      return res.status(403).render('error', { title: 'Forbidden',
        message: 'This record is above your clearance level.' });
    }
    await renderForm(req, res, emp);
  } catch (e) { next(e); }
});

async function renderForm(req, res, emp) {
  const db = getDb();
  const companyId = emp ? emp.company_id : scopedCompanyId(req);
  const banks = shapeMany(await db.collection('banks').find({}).sort({ sort_order: 1, name: 1 }).toArray());
  const departments = companyId
    ? shapeMany(await db.collection('departments').find({ company_id: oid(companyId) }).sort({ name: 1 }).toArray())
    : [];
  const jobFunctions = companyId
    ? shapeMany(await db.collection('job_functions').find({ company_id: oid(companyId) }).sort({ name: 1 }).toArray())
    : [];
  const companies = req.user.role === 'super_admin'
    ? shapeMany(await db.collection('companies').find({}).sort({ name: 1 }).toArray())
    : [];

  let empView = null;
  if (emp) {
    const [withDeptJobBank] = await withLookups(db, [emp]);
    empView = withBankAccounts(withDeptJobBank);
  }
  res.render('employees/edit', {
    title: emp ? 'Edit employee' : 'New employee',
    emp: empView, banks, departments, jobFunctions, companies,
    companyId: companyId ? companyId.toString() : null,
  });
}

router.post('/save', async (req, res, next) => {
  try {
    const db = getDb();
    const b = req.body;
    const companyId = scopedCompanyId(req);
    if (!companyId) return res.status(400).render('error', { title: 'Error', message: 'Company is required.' });

    async function resolveOrCreate(coll, name) {
      if (!name) return null;
      const found = await db.collection(coll).findOne({ company_id: companyId, name });
      if (found) return found._id;
      const r = await db.collection(coll).insertOne({ company_id: companyId, name });
      return r.insertedId;
    }
    const dept_id = await resolveOrCreate('departments', (b.department_name || '').trim());
    const job_id  = await resolveOrCreate('job_functions', (b.job_function_name || '').trim());

    const f = (key) => b[key] ? parseFloat(b[key]) || 0 : 0;
    const fields = {
      company_id: companyId,
      first_name: b.first_name, last_name: b.last_name,
      email: b.email || null,
      gender: b.gender || null,
      dob: b.dob || null,                            // NEW (Form B)
      start_date: b.start_date || null,
      end_date: b.end_date || null,
      is_active: b.is_active ? 1 : 0,
      address: b.address || null,
      // compensation
      pay_type: b.pay_type,
      annual_salary: b.pay_type === 'salary' ? f('annual_salary') : null,
      hourly_rate:   b.pay_type === 'hourly' ? f('hourly_rate')   : null,
      default_hours: b.default_hours ? parseFloat(b.default_hours) : null,
      fte_pct: b.fte_pct ? parseFloat(b.fte_pct) : 100,
      dependents: parseInt(b.dependents || '0', 10),
      // banking (multi-account split — accepts a parallel array from the form)
      bank_accounts: (() => {
        const ids   = [].concat(b['ba_bank_id']     || []);
        const brs   = [].concat(b['ba_branch']      || []);
        const accs  = [].concat(b['ba_account_no']  || []);
        const ans   = [].concat(b['ba_account_name']|| []);
        const pcts  = [].concat(b['ba_pct']         || []);
        const out = [];
        for (let i = 0; i < pcts.length; i++) {
          const pct = parseFloat(pcts[i]); if (!(pct > 0)) continue;
          if (!accs[i]) continue;
          out.push({
            bank_id: ids[i] ? oid(ids[i]) : null,
            branch_code: (brs[i] || '').trim() || null,
            account_no: (accs[i] || '').trim(),
            account_name: (ans[i] || '').trim(),
            percentage: pct,
          });
        }
        // Fallback: if the form posted nothing (e.g. an older single-bank
        // form), accept the legacy field names so we don't blow away banking.
        if (!out.length && (b.bank_account_no || b.bank_account_name)) {
          out.push({
            bank_id: b.bank_id ? oid(b.bank_id) : null,
            branch_code: b.branch_code || null,
            account_no: b.bank_account_no || '',
            account_name: b.bank_account_name || '',
            percentage: 100,
          });
        }
        return out;
      })(),
      // Also keep the legacy single-bank fields populated from the first
      // account so older queries and the CSV exporter still find them.
      bank_id: (() => {
        const ids = [].concat(b['ba_bank_id'] || b.bank_id || []);
        return ids[0] ? oid(ids[0]) : null;
      })(),
      bank_account_no:   ([].concat(b['ba_account_no']   || b.bank_account_no   || []))[0] || null,
      bank_account_name: ([].concat(b['ba_account_name'] || b.bank_account_name || []))[0] || null,
      branch_code:       ([].concat(b['ba_branch']       || b.branch_code       || []))[0] || null,
      // org
      department_id: dept_id,
      job_function_id: job_id,
      // taxable allowances (added to gross)
      housing_allowance:      f('housing_allowance'),
      vehicle_allowance:      f('vehicle_allowance'),
      fuel_allowance:         f('fuel_allowance'),
      meals_allowance:        f('meals_allowance'),
      school_fees_allowance:  f('school_fees_allowance'),
      leave_fares_allowance:  f('leave_fares_allowance'),
      electricity_allowance:  f('electricity_allowance'),
      gas_allowance:          f('gas_allowance'),
      phone_allowance:        f('phone_allowance'),
      airfares_allowance:     f('airfares_allowance'),
      extra_allowance:        f('extra_allowance'),
      // pre-tax deductions
      salary_sacrifice:       f('salary_sacrifice'),
      ncsl_voluntary:         f('ncsl_voluntary'),
      nas_extra_pct:          f('nas_extra_pct'),
      // post-tax deductions
      savings_deduction:      f('savings_deduction'),
      christmas_bonus:        f('christmas_bonus'),
      loan_repayment:         f('loan_repayment'),
      education_deduction:    f('education_deduction'),
      // access roles + master-user payouts
      is_payroll_admin: b.is_payroll_admin ? 1 : 0,
      is_company_admin: b.is_company_admin ? 1 : 0,
      payroll_share_pct: parseFloat(b.payroll_share_pct || '0'),
      // Visibility level: bookkeepers (2) can't see employees with level ≥ 2.
      // Default 0; only system_owner (4) or principal (3) can set it higher.
      clearance_level: (() => {
        const requested = parseInt(b.clearance_level || '0', 10) || 0;
        const cap = req.user.clearance_level - 1;
        return Math.min(requested, cap);
      })(),
      employee_notes: b.employee_notes || null,
    };
    // Validate: percentages must sum to 100 (allow 0.01 fuzz).
    const totalPct = (fields.bank_accounts || []).reduce((s, a) => s + (Number(a.percentage) || 0), 0);
    if (fields.bank_accounts.length && Math.abs(totalPct - 100) > 0.011) {
      return res.status(400).render('error', { title: 'Banking error',
        message: `Bank account percentages must sum to 100. Currently ${totalPct.toFixed(2)}.` });
    }

    if (b.id) {
      await db.collection('employees').updateOne({ _id: oid(b.id) }, { $set: fields });
    } else {
      fields.created_at = new Date();
      await db.collection('employees').insertOne(fields);
    }
    req.session.flash = { type: 'success', text: 'Employee saved.' };
    res.redirect(BASE + '/employees' + (req.user.role === 'super_admin' ? `?company=${companyId.toString()}` : ''));
  } catch (e) { next(e); }
});

// Quick deactivate endpoint — wired from the double-click-name UX on the
// payroll entry page. Marks the employee inactive; preserves history.
router.post('/:id/deactivate', async (req, res, next) => {
  try {
    const db = getDb();
    const emp = await db.collection('employees').findOne({ _id: oid(req.params.id) });
    if (!emp) return res.status(404).json({ ok: false });
    if (req.user.role !== 'super_admin' && emp.company_id.toString() !== req.user.company_id.toString()) {
      return res.status(403).json({ ok: false });
    }
    await db.collection('employees').updateOne(
      { _id: emp._id },
      { $set: { is_active: 0, end_date: emp.end_date || new Date().toISOString().slice(0, 10) } }
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
