// Auth middleware: bcrypt verify + session-based login + role gates.
//
// Role tree (highest to lowest):
//   system_owner (4)   — you. Sees everything, including the service-fee %.
//   principal    (3)   — bureau lead (Theresia). Manages companies and the
//                        people below her; cannot edit the service-fee %.
//   bookkeeper   (2)   — bureau staff. Employee CRUD, hours edits, approves
//                        payroll. Cannot see employee records of principal+.
//   site_payroll (1)   — per-company key person. Enters & submits hours for
//                        their assigned company only.
//   employee     (0)   — sees their own pay stubs only.
//
// Legacy role names from earlier in this codebase are accepted as aliases so
// existing user rows keep working.
const bcrypt = require('bcrypt');
const { getDb, oid, shapeId } = require('./db');

const CLEARANCE = {
  system_owner: 4, principal: 3, bookkeeper: 2, site_payroll: 1, employee: 0,
  // aliases from the previous schema
  super_admin: 4, company_admin: 3, payroll_admin: 1,
};

function clearanceOf(role) { return CLEARANCE[role] ?? 0; }
function normalizeRole(role) {
  // Return the canonical role name for an alias.
  const map = { super_admin: 'system_owner', company_admin: 'principal', payroll_admin: 'site_payroll' };
  return map[role] || role;
}

async function attachUser(req, res, next) {
  try {
    if (!req.session || !req.session.userId) return next();
    const db = getDb();
    const u = await db.collection('users').findOne({ _id: oid(req.session.userId), is_active: 1 });
    if (u) {
      req.user = shapeId(u);
      req.user.clearance_level = clearanceOf(u.role);
      req.user.role_canonical  = normalizeRole(u.role);
      res.locals.user = req.user;
      if (u.company_id) {
        const c = await db.collection('companies').findOne({ _id: oid(u.company_id) });
        if (c) {
          req.company = shapeId(c);
          res.locals.company = req.company;
        }
      }
    }
    next();
  } catch (e) { next(e); }
}

// requireAuth() = must be logged in.
// requireAuth(['system_owner', 'principal']) = role is one of those (or alias).
// requireAuth({ minLevel: 2 }) = clearance ≥ 2 (bookkeeper or above).
function requireAuth(allowed) {
  return (req, res, next) => {
    if (!req.user) {
      return res.redirect((process.env.BASE_PATH || '') + '/login');
    }
    if (!allowed) return next();
    if (Array.isArray(allowed)) {
      const canon = req.user.role_canonical;
      const accepted = allowed.map(normalizeRole);
      if (accepted.includes(canon)) return next();
      return res.status(403).render('error', { title: 'Forbidden', message: 'You do not have access to this page.' });
    }
    if (allowed.minLevel != null) {
      if (req.user.clearance_level >= allowed.minLevel) return next();
      return res.status(403).render('error', { title: 'Forbidden', message: 'Your account does not have sufficient access.' });
    }
    next();
  };
}

async function verifyPassword(plain, hash) { return bcrypt.compare(plain, hash); }
async function hashPassword(plain) { return bcrypt.hash(plain, 12); }

module.exports = {
  attachUser, requireAuth, verifyPassword, hashPassword,
  CLEARANCE, clearanceOf, normalizeRole,
};
