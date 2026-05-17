const express = require('express');
const router = express.Router();
const { getDb, oid, shapeMany } = require('../src/db');
const { DEFAULT_PNG_RULES } = require('../src/payroll');

const BASE = process.env.BASE_PATH || '';

function getCompanyId(req) {
  if (req.user.role === 'super_admin') return oid(req.query.company || req.body.company_id);
  return oid(req.user.company_id);
}

router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const companyId = getCompanyId(req);
    let current = null;
    if (companyId) {
      const arr = await db.collection('tax_rules')
        .find({ company_id: companyId })
        .sort({ effective_from: -1, _id: -1 })
        .limit(1).toArray();
      current = arr.length
        ? { ...arr[0], parsed: typeof arr[0].data === 'string' ? JSON.parse(arr[0].data) : arr[0].data }
        : { parsed: DEFAULT_PNG_RULES };
    }
    const companies = req.user.role === 'super_admin'
      ? shapeMany(await db.collection('companies').find({}).sort({ name: 1 }).toArray()) : [];
    res.render('taxrules/edit', {
      title: 'Tax rules', current, companies,
      companyId: companyId ? companyId.toString() : null,
    });
  } catch (e) { next(e); }
});

router.post('/save', async (req, res, next) => {
  try {
    const db = getDb();
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).render('error', { title: 'Error', message: 'No company.' });
    let parsed;
    try { parsed = JSON.parse(req.body.data); }
    catch (e) { return res.status(400).render('error', { title: 'Invalid JSON', message: e.message }); }
    await db.collection('tax_rules').insertOne({
      company_id: companyId,
      effective_from: req.body.effective_from || new Date().toISOString().slice(0, 10),
      data: parsed,
      notes: req.body.notes || null,
      created_at: new Date(),
    });
    req.session.flash = { type: 'success', text: 'Tax rules saved (new effective version).' };
    res.redirect(BASE + '/taxrules' + (req.user.role === 'super_admin' ? `?company=${companyId.toString()}` : ''));
  } catch (e) { next(e); }
});

module.exports = router;
