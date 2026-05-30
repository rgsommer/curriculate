const express = require('express');
const router = express.Router();
const { getDb, oid, shapeMany } = require('../src/db');

function getCompanyId(req) {
  if (req.user.role === 'super_admin') return oid(req.query.company);
  return oid(req.user.company_id);
}

router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const companyId = getCompanyId(req);
    const period = req.query.period || 'monthly';
    let summary = [], byDept = [], shares = [];
    if (companyId) {
      // Aggregate entries joined to pay_periods to bucket by week or month of pay_date.
      const dateFormat = period === 'weekly' ? '%Y-W%V' : '%Y-%m';
      summary = await db.collection('payroll_entries').aggregate([
        { $lookup: { from: 'pay_periods', localField: 'pay_period_id', foreignField: '_id', as: 'p' } },
        { $unwind: '$p' },
        { $match: { 'p.company_id': companyId } },
        { $group: {
            _id: { $dateToString: { format: dateFormat, date: { $dateFromString: { dateString: '$p.pay_date' } } } },
            gross: { $sum: '$gross' }, tax: { $sum: '$tax' }, nasfund: { $sum: '$nasfund' },
            other: { $sum: '$other_deductions' }, net: { $sum: '$net' },
            employees: { $addToSet: '$employee_id' },
        } },
        { $project: { bucket: '$_id', gross: 1, tax: 1, nasfund: 1, other: 1, net: 1, n_emp: { $size: '$employees' }, _id: 0 } },
        { $sort: { bucket: -1 } }, { $limit: 24 },
      ]).toArray();

      byDept = await db.collection('payroll_entries').aggregate([
        { $lookup: { from: 'pay_periods', localField: 'pay_period_id', foreignField: '_id', as: 'p' } },
        { $unwind: '$p' },
        { $match: { 'p.company_id': companyId } },
        { $lookup: { from: 'employees', localField: 'employee_id', foreignField: '_id', as: 'e' } },
        { $unwind: '$e' },
        { $lookup: { from: 'departments', localField: 'e.department_id', foreignField: '_id', as: 'd' } },
        { $unwind: { path: '$d', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$d.name', gross: { $sum: '$gross' }, net: { $sum: '$net' }, n: { $sum: 1 } } },
        { $project: { dept: '$_id', gross: 1, net: 1, n: 1, _id: 0 } },
        { $sort: { gross: -1 } },
      ]).toArray();

      shares = shapeMany(await db.collection('employees')
        .find({ company_id: companyId, payroll_share_pct: { $gt: 0 } })
        .toArray());
      // estimated cumulative share computed against total gross for company
      const totalAgg = await db.collection('payroll_entries').aggregate([
        { $lookup: { from: 'pay_periods', localField: 'pay_period_id', foreignField: '_id', as: 'p' } },
        { $unwind: '$p' },
        { $match: { 'p.company_id': companyId } },
        { $group: { _id: null, total: { $sum: '$gross' } } },
      ]).toArray();
      const totalGross = totalAgg.length ? totalAgg[0].total : 0;
      shares.forEach(s => { s.estimated_share_lifetime = +(totalGross * (s.payroll_share_pct || 0) / 100).toFixed(2); });
    }
    const companies = req.user.role === 'super_admin'
      ? shapeMany(await db.collection('companies').find({}).sort({ name: 1 }).toArray()) : [];
    res.render('reports/index', {
      title: 'Reports', summary, byDept, shares, period,
      companyId: companyId ? companyId.toString() : null, companies,
    });
  } catch (e) { next(e); }
});

module.exports = router;
