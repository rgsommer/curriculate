// Bulk-import employees from the "PNGPay Bulk Employees" spreadsheet (MongoDB).
const { getDb, oid } = require('./db');
const { DEFAULT_PNG_RULES } = require('./payroll');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (q) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') {}
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function toNum(s) {
  if (s == null) return 0;
  const t = String(s).replace(/[", ]/g, '').replace(/[^\d.\-]/g, '');
  const n = parseFloat(t);
  return isFinite(n) ? n : 0;
}

async function importEmployeesCsv(text) {
  const db = getDb();
  const rows = parseCsv(text).filter(r => r.length > 1);
  if (!rows.length) throw new Error('Empty CSV');
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const col = (n) => headers.indexOf(n);
  const idx = {
    fname:        col('fname'),     lname:    col('lname'),
    account_name: col('account_name'),
    bank_code:    col('bank_code'), bank_account: col('bank_account'),
    position:     col('position'),  department: col('department'),
    company:      col('company'),   datestarted: col('datestarted'),
    anual_price:  col('anual_price'), hour_price: col('hour_price'),
    hours:        col('hours'),     email:    col('email'),
    dependents:   col('dependents'),status:   col('status'),
  };
  for (const r of ['fname', 'lname', 'company']) {
    if (idx[r] < 0) throw new Error(`Missing required column: ${r}`);
  }
  // Optional extra columns from the user's spreadsheet
  const xcol = (n) => col(n);
  const optIdx = {
    dob:           xcol('dob'),
    branch_code:   xcol('branch_code'),
    allowance_housetype:  xcol('allowance_housetype'),
    allowance_vehicle:    xcol('allowance_vehicle'),
    allowance_fuel:       xcol('allowance_fuel'),
    meals:                xcol('meals'),
    school_fees:          xcol('school_fees'),
    leave_fares:          xcol('leave_fares'),
    allowance_electricity:xcol('allowance_electricity'),
    allowance_gas:        xcol('allowance_gas'),
    allowance_phone:      xcol('allowance_phone'),
    allowance_airfares:   xcol('allowance_airfares'),
    vol_salary:           xcol('vol_salary'),
    vol_ncsl:             xcol('vol_ncsl'),
    notes:                xcol('notes'),
    nas:                  xcol('nas'),
  };
  const optVal = (r, key) => optIdx[key] >= 0 ? toNum(r[optIdx[key]]) : 0;

  // Helpers with simple in-memory caching for the duration of the import.
  const compCache = new Map();
  async function ensureCompany(code) {
    if (compCache.has(code)) return compCache.get(code);
    let c = await db.collection('companies').findOne({ abbreviation: 'C' + code });
    if (!c) {
      const r = await db.collection('companies').insertOne({
        name: 'Company ' + code, abbreviation: 'C' + code,
        pay_interval: 'fortnightly', default_hours: 80,
        currency: 'PGK', is_active: 1, created_at: new Date(),
      });
      c = await db.collection('companies').findOne({ _id: r.insertedId });
      await db.collection('tax_rules').insertOne({
        company_id: c._id, effective_from: new Date().toISOString().slice(0, 10),
        data: DEFAULT_PNG_RULES, notes: 'Imported defaults', created_at: new Date(),
      });
    }
    compCache.set(code, c);
    return c;
  }
  async function ensureDept(companyId, code) {
    if (!code) return null;
    const name = 'Dept ' + code;
    const d = await db.collection('departments').findOneAndUpdate(
      { company_id: companyId, name },
      { $setOnInsert: { company_id: companyId, name } },
      { upsert: true, returnDocument: 'after' }
    );
    return d.value ? d.value._id : (await db.collection('departments').findOne({ company_id: companyId, name }))._id;
  }
  async function ensureJob(companyId, name) {
    if (!name) return null;
    const j = await db.collection('job_functions').findOneAndUpdate(
      { company_id: companyId, name },
      { $setOnInsert: { company_id: companyId, name } },
      { upsert: true, returnDocument: 'after' }
    );
    return j.value ? j.value._id : (await db.collection('job_functions').findOne({ company_id: companyId, name }))._id;
  }
  const bankCache = new Map();
  async function ensureBank(code) {
    if (!code) return null;
    if (bankCache.has(code)) return bankCache.get(code);
    let b;
    if (String(code) === '88' || String(code) === '088') {
      b = await db.collection('banks').findOne({ name: { $regex: '^Bank South Pacific' } });
    }
    if (!b) {
      const name = 'Bank ' + code;
      b = await db.collection('banks').findOne({ name });
      if (!b) {
        const r = await db.collection('banks').insertOne({ name, swift_code: null, sort_order: 200 });
        b = { _id: r.insertedId };
      }
    }
    bankCache.set(code, b._id);
    return b._id;
  }

  let created = 0, skipped = 0;
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const fname = (r[idx.fname] || '').trim();
    const lname = (r[idx.lname] || '').trim();
    const companyCode = (r[idx.company] || '').trim();
    if (!fname || !lname || !companyCode) { skipped++; continue; }
    try {
      const company = await ensureCompany(companyCode);
      const annual = toNum(r[idx.anual_price]);
      const hourly = toNum(r[idx.hour_price]);
      await db.collection('employees').insertOne({
        company_id: company._id,
        first_name: fname, last_name: lname,
        email: (r[idx.email] || '').trim() || null,
        dob: optIdx.dob >= 0 ? (r[optIdx.dob] || '').trim() || null : null,
        start_date: (r[idx.datestarted] || '').trim() || null,
        is_active: (String(r[idx.status]).trim() === '0') ? 0 : 1,
        pay_type: annual > 0 ? 'salary' : 'hourly',
        annual_salary: annual > 0 ? annual : null,
        hourly_rate:   annual > 0 ? null : (hourly || 0),
        default_hours: toNum(r[idx.hours]) || null,
        dependents: parseInt(r[idx.dependents] || '0', 10) || 0,
        bank_id: await ensureBank((r[idx.bank_code] || '').trim()),
        bank_account_no: (r[idx.bank_account] || '').trim() || null,
        bank_account_name: (r[idx.account_name] || '').trim() || null,
        branch_code: optIdx.branch_code >= 0 ? (r[optIdx.branch_code] || '').trim() || null : null,
        department_id: await ensureDept(company._id, (r[idx.department] || '').trim()),
        job_function_id: await ensureJob(company._id, (r[idx.position] || '').trim()),
        // map the spreadsheet's allowance/deduction columns into the new fields
        housing_allowance:    0,                       // spreadsheet has Yes/No flag, not a value
        vehicle_allowance:    0,                       // (allowance_vehicle is Yes/No)
        fuel_allowance:       0,
        meals_allowance:      optVal(r, 'meals'),
        school_fees_allowance: optVal(r, 'school_fees'),
        leave_fares_allowance: optVal(r, 'leave_fares'),
        electricity_allowance: optVal(r, 'allowance_electricity'),
        gas_allowance:         optVal(r, 'allowance_gas'),
        phone_allowance:       optVal(r, 'allowance_phone'),
        airfares_allowance:    optVal(r, 'allowance_airfares'),
        extra_allowance:       0,
        salary_sacrifice:      optVal(r, 'vol_salary'),
        ncsl_voluntary:        optVal(r, 'vol_ncsl'),
        nas_extra_pct:         optVal(r, 'nas'),
        employee_notes:        optIdx.notes >= 0 ? (r[optIdx.notes] || '').trim() || null : null,
        created_at: new Date(),
      });
      created++;
    } catch (e) { errors.push(`Row ${i + 1} (${fname} ${lname}): ${e.message}`); }
  }
  return { created, skipped, errors };
}

module.exports = { importEmployeesCsv };
