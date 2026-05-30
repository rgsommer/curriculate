-- PNGPay schema. SQLite. Multi-tenant: every company-scoped row carries company_id.
-- Run by scripts/migrate.js. Idempotent (CREATE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS companies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  abbreviation    TEXT,
  pay_interval    TEXT NOT NULL DEFAULT 'fortnightly', -- weekly | fortnightly | monthly
  default_hours   REAL NOT NULL DEFAULT 80,            -- hours per pay period (80 = fortnightly @ 40/wk)
  currency        TEXT NOT NULL DEFAULT 'PGK',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  is_active       INTEGER NOT NULL DEFAULT 1,
  -- Company banking (used when generating the BSP batch file)
  bank_account_name TEXT,
  bank_code         TEXT,       -- '088' = BSP
  branch_code       TEXT,
  bank_account_no   TEXT,
  bank_client_no    TEXT,       -- BSP "Client Number" required for batch upload
  -- Office / payroll officer
  office_email      TEXT,
  payroll_officer_name  TEXT,
  payroll_officer_title TEXT,
  -- Pay-stub email behaviour
  email_payslips    INTEGER NOT NULL DEFAULT 1,
  cc_office         INTEGER NOT NULL DEFAULT 1,
  payslip_message   TEXT DEFAULT 'Attached is your pay slip for the current pay period. The funds will be deposited automatically. Contact the office if you have any questions.',
  -- Superannuation / NASFund (NCSL on the legacy setup form)
  ncsl_employer_no  TEXT,
  ncsl_date_of_reg  TEXT,
  -- Top-level manager (gets oversight emails)
  manager_email     TEXT,
  manager_title     TEXT
);

-- Users = login accounts. May or may not be linked to an employee row.
-- Roles: super_admin (you - sees all companies), company_admin (master user),
-- payroll_admin (the person who enters hours), employee (view own stubs).
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE, -- NULL = super_admin
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('super_admin','company_admin','payroll_admin','employee')),
  employee_id     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);

CREATE TABLE IF NOT EXISTS banks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  swift_code      TEXT,
  sort_order      INTEGER DEFAULT 100
);

CREATE TABLE IF NOT EXISTS departments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS job_functions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS employees (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  email           TEXT,                   -- where the pay stub is sent
  gender          TEXT CHECK (gender IN ('M','F','X') OR gender IS NULL),
  start_date      TEXT,                   -- ISO date
  end_date        TEXT,                   -- nullable; set on termination
  is_active       INTEGER NOT NULL DEFAULT 1,
  address         TEXT,
  -- compensation
  pay_type        TEXT NOT NULL CHECK (pay_type IN ('salary','hourly')),
  annual_salary   REAL,                   -- used if pay_type='salary'
  hourly_rate     REAL,                   -- used if pay_type='hourly'
  default_hours   REAL,                   -- per-employee override of company default
  dependents      INTEGER NOT NULL DEFAULT 0,
  -- banking
  bank_id         INTEGER REFERENCES banks(id),
  bank_account_no TEXT,
  bank_account_name TEXT,
  -- org
  department_id   INTEGER REFERENCES departments(id),
  job_function_id INTEGER REFERENCES job_functions(id),
  -- access roles for this employee (mirrored as a User row if they need login)
  is_payroll_admin INTEGER NOT NULL DEFAULT 0,   -- enters hours for this company
  is_company_admin INTEGER NOT NULL DEFAULT 0,   -- master user for this company
  -- master-user payroll share (percentage of total payroll, applied each run).
  -- Spec: "several employees (likely only two) may be set to receive a percentage of the total payroll".
  payroll_share_pct REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_active  ON employees(company_id, is_active);

-- One row per payroll run.
CREATE TABLE IF NOT EXISTS pay_periods (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start    TEXT NOT NULL,          -- ISO date
  period_end      TEXT NOT NULL,
  pay_date        TEXT NOT NULL,          -- when employees actually get paid
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_periods_company ON pay_periods(company_id, period_start);

-- One row per employee per pay period.
CREATE TABLE IF NOT EXISTS payroll_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pay_period_id   INTEGER NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  employee_id     INTEGER NOT NULL REFERENCES employees(id),
  hours           REAL NOT NULL DEFAULT 0,
  cash_advance    REAL NOT NULL DEFAULT 0,
  note            TEXT,
  -- computed at confirm time and frozen for audit
  gross           REAL,
  tax             REAL,
  nasfund         REAL,
  other_deductions REAL,
  net             REAL,
  calc_breakdown  TEXT,                   -- JSON of every line item used to compute
  UNIQUE(pay_period_id, employee_id)
);

-- Tax & deduction rules per company. Editable in the Tax Rules tab.
-- JSON in `data` lets you change shape without migrations.
CREATE TABLE IF NOT EXISTS tax_rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  effective_from  TEXT NOT NULL DEFAULT (date('now')),
  data            TEXT NOT NULL,          -- JSON; see src/payroll.js for shape
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_taxrules_company ON tax_rules(company_id, effective_from);
