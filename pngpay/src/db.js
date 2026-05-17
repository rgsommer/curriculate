// MongoDB wrapper. Exposes a `db` accessor + helpers for the rest of the app.
// One MongoClient per process. Connect lazily on first use.
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');

// Accept both MONGO_URI (Curriculate convention) and MONGODB_URI (generic).
// On the curriculate.net Atlas cluster, PNGPay lives in its own database
// (default 'pngpay') so collections don't collide with curriculate's.
const URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGO_DB || process.env.MONGODB_DB || 'pngpay';

if (!URI) {
  console.warn('WARNING: MONGO_URI not set. Set it in .env before starting the server.');
}

let _client = null;
let _db = null;
let _ready = null;

async function connect() {
  if (_db) return _db;
  if (_ready) return _ready; // a connection is already in flight
  _ready = (async () => {
    // Connection options mirrored from curriculate/backend/index.js so PNGPay
    // behaves like a sibling service on the same Atlas cluster.
    _client = new MongoClient(URI, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
      heartbeatFrequencyMS: 10_000,
      maxPoolSize: 20,
    });
    await _client.connect();
    _db = _client.db(DB_NAME);
    await ensureIndexes();
    return _db;
  })();
  return _ready;
}

async function ensureIndexes() {
  await _db.collection('users').createIndex({ email: 1 }, { unique: true });
  await _db.collection('users').createIndex({ company_id: 1 });
  await _db.collection('employees').createIndex({ company_id: 1, last_name: 1 });
  await _db.collection('employees').createIndex({ company_id: 1, is_active: 1 });
  await _db.collection('departments').createIndex({ company_id: 1, name: 1 }, { unique: true });
  await _db.collection('job_functions').createIndex({ company_id: 1, name: 1 }, { unique: true });
  await _db.collection('pay_periods').createIndex({ company_id: 1, period_start: -1 });
  await _db.collection('payroll_entries').createIndex({ pay_period_id: 1 });
  await _db.collection('payroll_entries').createIndex({ pay_period_id: 1, employee_id: 1 }, { unique: true });
  await _db.collection('tax_rules').createIndex({ company_id: 1, effective_from: -1 });
  await _db.collection('banks').createIndex({ name: 1 }, { unique: true });
}

// Convert _id → id so EJS templates and existing code don't need to change.
function shapeId(doc) {
  if (!doc) return doc;
  const out = { ...doc };
  if (doc._id) out.id = doc._id.toString();
  return out;
}
function shapeMany(docs) { return docs.map(shapeId); }

// Compatibility shim: collapse legacy single-bank fields into bank_accounts[]
// at read time. The persisted shape can also have bank_accounts[] directly.
function withBankAccounts(emp) {
  if (!emp) return emp;
  if (Array.isArray(emp.bank_accounts) && emp.bank_accounts.length > 0) return emp;
  if (emp.bank_id || emp.bank_account_no || emp.bank_account_name) {
    return {
      ...emp,
      bank_accounts: [{
        bank_id:           emp.bank_id || null,
        branch_code:       emp.branch_code || null,
        account_no:        emp.bank_account_no || '',
        account_name:      emp.bank_account_name || '',
        percentage:        100,
      }],
    };
  }
  return { ...emp, bank_accounts: [] };
}

// Robust ObjectId coercion. Accepts string or ObjectId; returns ObjectId or null.
function oid(v) {
  if (!v) return null;
  if (v instanceof ObjectId) return v;
  try { return new ObjectId(String(v)); } catch { return null; }
}

// Apply schema-level seeds + bootstrap super_admin (idempotent).
async function initDb() {
  await connect();
  await seedBanks();
  await bootstrapSuperAdmin();
}

async function seedBanks() {
  const banks = [
    ['Bank South Pacific (BSP)',  'BOSPPGPM', 10],
    ['Kina Bank',                 'KINBPGPM', 20],
    ['Westpac PNG',               'WPACPGPX', 30],
    ['ANZ PNG',                   'ANZBPGPX', 40],
    ['National Development Bank', null,       50],
    ['MiBank',                    null,       60],
    ['Other / Cash',              null,       99],
  ];
  for (const [name, swift, sort_order] of banks) {
    await _db.collection('banks').updateOne(
      { name },
      { $setOnInsert: { name, swift_code: swift, sort_order } },
      { upsert: true }
    );
  }
}

async function bootstrapSuperAdmin() {
  const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL;
  const pw    = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
  if (!email || !pw) return;
  const existing = await _db.collection('users').findOne({ email: email.toLowerCase() });
  if (existing) return;
  const password_hash = await bcrypt.hash(pw, 12);
  await _db.collection('users').insertOne({
    email: email.toLowerCase(),
    password_hash,
    role: 'super_admin',
    company_id: null,
    is_active: 1,
    created_at: new Date(),
  });
  console.log(`Bootstrapped super_admin: ${email}`);
}

// Async middleware that ensures the connection is up before the route runs.
function dbMiddleware(req, res, next) {
  connect().then(() => next()).catch(next);
}

// Exported accessor — call after connect().
function getDb() {
  if (!_db) throw new Error('DB not connected. Did you await initDb() or use dbMiddleware?');
  return _db;
}

module.exports = {
  connect, initDb, getDb, dbMiddleware,
  shapeId, shapeMany, withBankAccounts, oid, ObjectId,
};
