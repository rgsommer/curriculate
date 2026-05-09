/**
 * Shared helpers for the Field Day backend.
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const PASSKEY_TTL_MIN     = parseInt(process.env.FIELDDAY_PASSKEY_TTL_MIN     || "15", 10);
const SESSION_TTL_DAYS    = parseInt(process.env.FIELDDAY_SESSION_TTL_DAYS    || "14", 10);
const CODE_CHANGE_TTL_MIN = parseInt(process.env.FIELDDAY_CODE_CHANGE_TTL_MIN || "30", 10);

function gen6() { return String(Math.floor(100000 + Math.random()*900000)); }
function genToken() { return crypto.randomBytes(32).toString("hex"); }

async function hash(value)            { return bcrypt.hash(String(value), 10); }
async function verify(value, hashed)  { return bcrypt.compare(String(value), String(hashed||"")); }

function passkeyExpiresAt() { return new Date(Date.now() + PASSKEY_TTL_MIN * 60 * 1000); }
function sessionExpiresAt() { return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000); }
function codeChangeExpiresAt() { return new Date(Date.now() + CODE_CHANGE_TTL_MIN * 60 * 1000); }

/** Standardized JSON error response. */
function errResp(res, status, code) {
  return res.status(status).json({ error: code });
}

/** Promise-aware handler wrapper so route handlers can throw / reject. */
function asyncH(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Strips a school doc to the public/admin shape the client expects. */
function publicSchool(school) {
  if (!school) return null;
  return {
    id:                school._id.toString(),
    name:              school.name,
    code:              school.code,
    masterAdminEmail:  school.masterAdminEmail,
    adminEmails:       school.adminEmails || [],
    ageCategories:     school.ageCategories || [],
    ageBands:          school.ageBands || [],
    ageCutoffDate:     school.ageCutoffDate,
    eventLibrary:      school.eventLibrary || [],
    eventDefaults:     school.eventDefaults || {},
    eventRules:        school.eventRules || {},
    eventStaff:        school.eventStaff || {},
    divisions:         school.divisions || [],
    houses:            school.houses || [],
    tieMethod:         school.tieMethod,
    scoring:           school.scoring,
    records:           school.records || [],
    standards:         school.standards || [],
    personalBests:     school.personalBests || [],
    archives:          school.archives || [],
    createdAt:         school.createdAt
  };
}

/** Strips an event doc to the client-friendly shape. */
function publicEvent(ev) {
  if (!ev) return null;
  const o = ev.toObject ? ev.toObject() : ev;
  o.id = o._id ? o._id.toString() : o.id;
  delete o._id;
  return o;
}

module.exports = {
  PASSKEY_TTL_MIN, SESSION_TTL_DAYS, CODE_CHANGE_TTL_MIN,
  gen6, genToken, hash, verify,
  passkeyExpiresAt, sessionExpiresAt, codeChangeExpiresAt,
  errResp, asyncH,
  publicSchool, publicEvent
};
