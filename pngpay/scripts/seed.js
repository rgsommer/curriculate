#!/usr/bin/env node
require('dotenv').config();
const { connect, getDb } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { DEFAULT_PNG_RULES } = require('../src/payroll');

(async () => {
  await connect();
  const db = getDb();
  const existing = await db.collection('companies').findOne({ name: 'Demo Co' });
  if (existing) { console.log('Demo Co already exists.'); process.exit(0); }
  const c = await db.collection('companies').insertOne({
    name: 'Demo Co', abbreviation: 'DEMO',
    pay_interval: 'fortnightly', default_hours: 80, currency: 'PGK', is_active: 1,
    bank_account_name: 'Demo Co', bank_code: '088', branch_code: '307',
    bank_account_no: '1001577000',
    payroll_officer_name: 'Demo Officer',
    manager_email: process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || 'admin@example.com',
    manager_title: 'Finance Manager',
    created_at: new Date(),
  });
  const companyId = c.insertedId;
  await db.collection('tax_rules').insertOne({
    company_id: companyId, effective_from: new Date().toISOString().slice(0, 10),
    data: DEFAULT_PNG_RULES, notes: 'Seed defaults', created_at: new Date(),
  });
  const bsp = await db.collection('banks').findOne({ name: /^Bank South Pacific/ });
  const employees = [
    { first_name: 'Theresia', last_name: 'Bob', pay_type: 'salary', annual_salary: 186979, bank_account_no: '7003907305', bank_account_name: 'Theresia Bob', dependents: 2 },
    { first_name: 'Mark', last_name: 'Boas', pay_type: 'hourly', hourly_rate: 12.50, bank_account_no: '7029602278', bank_account_name: 'Mark Boas', dependents: 2 },
    { first_name: 'Elsie', last_name: 'Ogi', pay_type: 'salary', annual_salary: 3250, bank_account_name: 'Elsie Ogi', dependents: 2 },
  ];
  for (const e of employees) {
    await db.collection('employees').insertOne({
      company_id: companyId, is_active: 1,
      bank_id: bsp ? bsp._id : null, created_at: new Date(),
      annual_salary: null, hourly_rate: null, default_hours: null,
      ...e,
    });
  }
  const adminEmail = 'demo.admin@example.com';
  if (!(await db.collection('users').findOne({ email: adminEmail }))) {
    await db.collection('users').insertOne({
      company_id: companyId, email: adminEmail,
      password_hash: await hashPassword('demo123'),
      role: 'company_admin', is_active: 1, created_at: new Date(),
    });
    console.log(`Seeded company_admin: ${adminEmail} / demo123`);
  }
  console.log(`Demo Co seeded (${employees.length} employees).`);
  process.exit(0);
})();
