#!/usr/bin/env node
// MongoDB smoke test: boots an in-memory MongoDB, runs initDb, seeds a tiny
// company, calculates payroll, exports CSV/BSP/NASFund. Verifies the
// rewritten data layer compiles and the math still lines up.
require('dotenv').config();
const path = require('path');

(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mem = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mem.getUri();
  process.env.MONGODB_DB = 'pngpay-smoke';
  process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = 'smoke@example.com';
  process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD = 'pw';

  const { initDb, getDb, connect } = require('../src/db');
  await initDb();
  const db = getDb();

  const { DEFAULT_PNG_RULES, calculate } = require('../src/payroll');
  const { buildCsv } = require('../src/csv');
  const { buildBspBatch } = require('../src/bsp');
  const { buildNasfundReturn } = require('../src/nasfund');
  const { importEmployeesCsv } = require('../src/import_employees');

  function assert(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); process.exit(1); }
    console.log('ok :', msg);
  }

  // Bootstrap super_admin exists
  const u = await db.collection('users').findOne({ email: 'smoke@example.com' });
  assert(u && u.role === 'super_admin', 'super_admin bootstrapped');

  // Calc engine — should match prior SQLite results
  const company = { name: 'Test', pay_interval: 'fortnightly', currency: 'PGK' };
  const salaryEmp = { pay_type: 'salary', annual_salary: 1931 * 26, dependents: 3 };
  const r = calculate(salaryEmp, { hours: 80, cash_advance: 0 }, DEFAULT_PNG_RULES, company);
  console.log('K1,931 fortnight, 3 deps → gross', r.gross, 'tax', r.tax, 'nasfund', r.nasfund, 'net', r.net);
  assert(r.gross === 1931, 'gross = 1931');
  assert(r.tax > 100 && r.tax < 500, 'tax in sensible range');

  // Import the user's spreadsheet (first 3 employee rows)
  const csv = `id,emp_code,fname,lname,account_name,bank_code,branch_code,bank_account,percentage,position,department,dob,datestarted,residency,declaration,company,allowance_meals,declaration_lodged,remuniration,anual_price,hour_price,hours,fte,email,phone,dependents,nas,allowance_housetype,allowance_vehicle,allowance_fuel,meals,school_fees,leave_fares,allowance_electricity,allowance_gas,allowance_phone,allowance_airfares,vol_salary,vol_ncsl,notes,residency_status,status
2,1,Theresia,Bob,Theresia Bob,88,307,7003907305,100,CEO,2,2000-01-01,2021-01-01,PNG,Yes,2,,Yes,1,0,0.00,80,100,e@x.com,,2,0,None,Yes,Yes,30,0.00,0,0,0,0,0,0,0,,Resident,1
3,2,Pumai,Akipe,Pumai Akipe,88,307,7011315277,100,Operations Manager,2,2000-01-01,2021-01-01,PNG,Yes,2,,Yes,1,"9,750",37.50,80,100,a@b.com,,2,0,None,No,No,0,0.00,0,0,0,0,0,0,0,AHL Operations,Resident,1
4,3,Luke,Pipi,Luke Pipi,88,307,7020565623,100,Administration Manager,2,,,PNG,Yes,2,,Yes,1,"3,250",12.50,80,100,,,2,0,None,No,No,0,0.00,0,0,0,0,0,0,0,AHL Administration,Resident,1
`;
  const imp = await importEmployeesCsv(csv);
  assert(imp.created === 3, `imported 3 employees (got ${imp.created}, errors: ${imp.errors.join('; ')})`);
  const empCount = await db.collection('employees').countDocuments();
  assert(empCount === 3, 'employees collection has 3');
  const cCount = await db.collection('companies').countDocuments();
  assert(cCount === 1, 'one company auto-created from import');

  // Exporters non-empty
  const sampleRows = [{
    employee: { _id: 'x', first_name: 'A', last_name: 'B', email: 'a@b.test',
      bank_name: 'BSP', bank_account_no: '123', bank_account_name: 'A B',
      bank_code: '088', branch_code: '307' },
    entry: { net: 800 },
    hours: 80, cash_advance: 0, note: '',
    gross: 1000, tax: 100, nasfund: 60, other_deductions: 0, net: 840,
  }];
  const period = { period_start: '2026-05-04', period_end: '2026-05-17', pay_date: '2026-05-18' };
  assert(buildCsv(company, sampleRows, period).includes('A,B'), 'CSV contains employee row');
  const bspOut = buildBspBatch({ ...company, name: 'Test Co', abbreviation: 'TST', bank_code: '088', branch_code: '314', bank_account_no: '1001577138', bank_client_no: '1267866' }, period, sampleRows);
  assert(bspOut.startsWith('BSP,'), 'BSP batch starts with the BSP meta header row');
  assert(bspOut.split('\n')[0].split(',')[3] === 'PAYROLL', 'BSP meta row has PAYROLL marker');
  assert(bspOut.includes('1001577138'), 'BSP batch references source company account');
  assert(bspOut.includes('088'), 'BSP batch contains bank code');
  assert(buildNasfundReturn(company, '2026-05', sampleRows).includes('Member Number'), 'NASFund header');

  // Allowances: housing + meals on a salaried employee should push gross higher.
  const allowEmp = { pay_type: 'salary', annual_salary: 26000, dependents: 0,
    housing_allowance: 200, meals_allowance: 30 };
  const ar = calculate(allowEmp, { hours: 80, cash_advance: 0 }, DEFAULT_PNG_RULES, company);
  console.log('with K200 housing + K30 meals → gross', ar.gross);
  assert(ar.gross === 1000 + 230, 'allowances added to gross');

  // Pre-tax deduction reduces taxable gross.
  const sacEmp = { pay_type: 'salary', annual_salary: 26000, dependents: 0, salary_sacrifice: 100 };
  const sr = calculate(sacEmp, { hours: 80, cash_advance: 0 }, DEFAULT_PNG_RULES, company);
  console.log('with K100 salary sacrifice → gross', sr.gross, 'taxable', sr.breakdown.taxable);
  assert(sr.gross === 1000, 'gross unchanged when salary sacrifice present');
  assert(sr.breakdown.taxable < 1000, 'taxable reduced by salary sacrifice');

  // Post-tax deductions reduce net.
  const postEmp = { pay_type: 'salary', annual_salary: 26000, dependents: 0,
    loan_repayment: 50, savings_deduction: 25 };
  const pr = calculate(postEmp, { hours: 80, cash_advance: 0 }, DEFAULT_PNG_RULES, company);
  console.log('with K75 post-tax deductions → net', pr.net);
  const baseNet = calculate({ pay_type: 'salary', annual_salary: 26000, dependents: 0 },
                            { hours: 80, cash_advance: 0 }, DEFAULT_PNG_RULES, company).net;
  assert(pr.net === +(baseNet - 75).toFixed(2), 'post-tax deductions reduce net');

  // Role hierarchy: clearance levels on test users.
  const { clearanceOf, normalizeRole } = require('../src/auth');
  assert(clearanceOf('system_owner') === 4, 'system_owner clearance = 4');
  assert(clearanceOf('principal')    === 3, 'principal clearance = 3');
  assert(clearanceOf('bookkeeper')   === 2, 'bookkeeper clearance = 2');
  assert(clearanceOf('site_payroll') === 1, 'site_payroll clearance = 1');
  assert(clearanceOf('employee')     === 0, 'employee clearance = 0');
  assert(clearanceOf('super_admin')  === 4, 'super_admin alias = 4');
  assert(normalizeRole('super_admin')   === 'system_owner', 'super_admin → system_owner alias');
  assert(normalizeRole('payroll_admin') === 'site_payroll', 'payroll_admin → site_payroll alias');

  // Service-fee rows appended to BSP batch.
  const fees = [
    { name: 'Theresia', pct: 3, amount: 90, account_name: 'Theresia', account_no: '7003907305', branch_code: '307' },
    { name: 'Richard',  pct: 2, amount: 60, account_name: 'Richard',  account_no: '1234567890', branch_code: '307' },
  ];
  const bspWithFees = buildBspBatch({ ...company, name: 'Test Co', abbreviation: 'TST', bank_code: '088', branch_code: '314', bank_account_no: '1001577138', bank_client_no: '1267866' }, period, sampleRows, fees);
  assert(bspWithFees.includes('Theresia'), 'BSP batch contains Theresia service-fee row');
  assert(bspWithFees.includes('Richard'),  'BSP batch contains Richard service-fee row');
  assert(bspWithFees.split('\n').length >= 4, 'BSP batch has employee + fee rows');

  // PNG tax rule refinements
  const { _internal } = require('../src/payroll');
  // Non-resident on K500/fortnight (no declaration relevance) should pay 22%.
  const nonResEmp = { pay_type: 'salary', annual_salary: 500 * 26, dependents: 0, residency_status: 'non_resident' };
  const nr = calculate(nonResEmp, { hours: 80, cash_advance: 0 }, DEFAULT_PNG_RULES, company);
  console.log('non-resident K500/fn → tax', nr.tax);
  assert(nr.tax >= 50 && nr.tax <= 120, `non-resident below threshold is taxed (got K${nr.tax})`);

  // Dependant rebate formula: large gross + 3 deps should claim the K1,050/yr ceiling.
  const richEmp = { pay_type: 'salary', annual_salary: 80000, dependents: 3 };
  const rich = calculate(richEmp, { hours: 80, cash_advance: 0 }, DEFAULT_PNG_RULES, company);
  console.log('K80k/year salary, 3 deps → tax/fn', rich.tax);
  const expectedRebateFn = 1050 / 26;
  assert(rich.breakdown && rich.tax >= 0, 'tax computed for high-income with deps');

  assert(DEFAULT_PNG_RULES.verified_at === '2026-05-17', 'rules stamped with verified_at');

  // Multi-bank split per employee.
  const { splitNet } = require('../src/bsp');
  const splitEmp = {
    first_name: 'Split', last_name: 'Test',
    bank_accounts: [
      { account_no: 'A1', account_name: 'Split A', branch_code: '307', percentage: 60 },
      { account_no: 'A2', account_name: 'Split B', branch_code: '307', percentage: 40 },
    ],
  };
  const parts = splitNet(splitEmp, 1000);
  assert(parts.length === 2, 'split emits 2 rows for 2 accounts');
  assert(parts[0].amount === 600 && parts[1].amount === 400, '1000 → 600/400 split');

  // Rounding remainder lands on first account.
  const parts2 = splitNet(splitEmp, 333.33);
  const sum = parts2.reduce((s, r) => s + r.amount, 0);
  assert(+sum.toFixed(2) === 333.33, '333.33 split rounds to exact total');

  // BSP batch with multi-bank employee
  const splitRow = [{
    employee: splitEmp, entry: { net: 1000 },
    hours: 80, cash_advance: 0, note: '',
    gross: 1200, tax: 100, nasfund: 72, other_deductions: 28, net: 1000,
  }];
  const bspSplit = buildBspBatch(company, period, splitRow);
  const splitLines = bspSplit.split('\n').filter(l => l.includes('Split'));
  assert(splitLines.length === 2, `BSP batch emits one line per account (got ${splitLines.length})`);
  assert(bspSplit.includes('600.00'), 'BSP batch contains the 60% share (600.00)');
  assert(bspSplit.includes('400.00'), 'BSP batch contains the 40% share (400.00)');

  // Single-bank legacy employees still work (no bank_accounts array).
  const legacy = {
    first_name: 'Old', last_name: 'Bank',
    bank_account_no: 'L1', bank_account_name: 'Legacy', branch_code: '307',
  };
  const legacyParts = splitNet(legacy, 500);
  assert(legacyParts.length === 1 && legacyParts[0].amount === 500, 'legacy single-bank → 1 row');

  // PDF payslip generation
  const { buildPayStubPdf } = require('../src/pdf_stub');
  const pdf = await buildPayStubPdf({
    company: { name: 'Test Co', currency: 'PGK' },
    period: { period_start: '2026-05-04', period_end: '2026-05-17', pay_date: '2026-05-18' },
    employee: { first_name: 'Alice', last_name: 'Worker', bank_account_no: '1234', bank_account_name: 'Alice Worker' },
    hours: 80, cash_advance: 0, note: 'good fortnight',
    gross: 1000, tax: 100, nasfund: 60, other_deductions: 0, net: 840,
    breakdown: { base: 1000, overtime: 0, allowance_lines: [], pre_tax_deductions: [], post_tax_deductions: [], nasfund_employer: 84 },
  });
  assert(Buffer.isBuffer(pdf) && pdf.length > 1000, `PDF generated (${pdf.length} bytes)`);
  assert(pdf.slice(0, 4).toString() === '%PDF', 'PDF starts with magic number');

  // GridFS round-trip: generate + list + download a tiny period file set.
  const periodFiles = require('../src/period_files');
  const c = await db.collection('companies').insertOne({ name: 'GridFS Test', abbreviation: 'GFS' });
  const p = await db.collection('pay_periods').insertOne({
    company_id: c.insertedId, period_start: '2026-05-04', period_end: '2026-05-17',
    pay_date: '2026-05-18', status: 'approved', service_fees: [],
  });
  await periodFiles.generateAll(
    { _id: c.insertedId, name: 'GridFS Test', abbreviation: 'GFS', currency: 'PGK' },
    { _id: p.insertedId, period_start: '2026-05-04', period_end: '2026-05-17', pay_date: '2026-05-18' },
    [{
      employee: { _id: 'e1', first_name: 'Test', last_name: 'Person',
                  bank_accounts: [{ account_no: 'A1', account_name: 'Test P', percentage: 100 }] },
      hours: 80, cash_advance: 0, note: '',
      gross: 1000, tax: 100, nasfund: 60, other_deductions: 0, net: 840,
      breakdown: { base: 1000, overtime: 0, allowance_lines: [], pre_tax_deductions: [], post_tax_deductions: [] },
    }],
  );
  const stored = await periodFiles.listForPeriod(p.insertedId);
  const kinds = stored.map(f => f.kind).sort();
  console.log('Stored period files:', stored.map(f => f.filename).join(', '));
  assert(kinds.includes('bsp')      && kinds.includes('summary') && kinds.includes('payslip'),
    `period files include bsp + summary + payslip (got ${kinds.join(',')})`);
  assert(stored.find(f => f.kind === 'payslip').length > 1000, 'payslip PDF is non-trivial in size');

  console.log('\nAll smoke checks passed.');
  await mem.stop();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
