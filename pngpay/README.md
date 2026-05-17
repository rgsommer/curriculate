# PNGPay

Multi-tenant payroll for PNG SMEs. Web-based replacement for the legacy
MS Access PNGPay app. Designed to be mounted at `/pngpay` on
curriculate.net (or anywhere else — set `BASE_PATH` in `.env`).

## Features

- **Multi-tenant.** Each company is fully isolated; super-admin sees all.
- **Roles:** super_admin / company_admin / payroll_admin / employee.
- **Employee data** with tabbed editor (personal, employment, banking,
  compensation, access & payouts).
- **Bulk import** matched to the legacy "PNGPay Bulk Employees" sheet.
- **Pay-period workflow:** list active employees, double-click an hours
  cell to fill the default for that employee, double-click again to zero
  (didn't work). Cash advances and per-employee notes (shown on the stub).
- **Calculation engine** (`src/payroll.js`) with PNG SWT brackets (2023),
  Nasfund 6%/8.4%, dependent rebates, overtime, and free-form custom
  deductions (flat, percent, or formula). Heavily commented for editing.
- **CSV export** of every confirmed pay period.
- **Pay-stub emails** via Resend (or spooled to `data/outbox/` if no API key).
- **BSP batch file** export ready to upload to BSP Batch Manager.
- **NASFund return** CSV per period.
- **Tax rules UI:** edit brackets/deductions per-company without touching code.
- **Weekly / monthly summary reports.**

## Local dev

```bash
cp .env.example .env       # then fill in values
npm install
npm run migrate
npm run seed               # optional demo data
npm run smoke              # sanity-check the calc engine
npm start                  # http://localhost:3000/pngpay/login
```

## Deploy

See `DEPLOY.md`.

## Where to edit business logic

| What | File |
|------|------|
| Tax brackets, Nasfund, custom deductions | `src/payroll.js` (defaults) + Tax Rules UI (per company) |
| CSV columns | `src/csv.js` |
| BSP batch format | `src/bsp.js` |
| NASFund return columns | `src/nasfund.js` |
| Pay-stub email HTML | `src/email.js` |
| DB schema | `db/schema.sql` (+ soft ALTER list in `src/db.js`) |

## Tech

Node 18+, Express, EJS, MongoDB (any 5.x/6.x/7.x cluster), bcrypt,
express-session with connect-mongo, Resend. No JS bundler, no React,
no build step. Everything is server-rendered.

## Deployment

See `deploy/LAUNCH.md` for the full launch procedure. Short version:
PNGPay lives as `pngpay/` inside the Curriculate monorepo. Render
Blueprint deploy reads `pngpay/render.yaml` (with `rootDir: pngpay`),
then a 5-line rewrite added to curriculate.net's host config makes
`/pngpay/*` proxy to the Render URL — so the user sees
`https://www.curriculate.net/pngpay/login`.

Moving to a dedicated repo and/or `pngpay.curriculate.net` later is a
~15-min change with no data migration — see the LAUNCH doc.

## Role hierarchy

| Level | Role           | Can do                                                  |
|------:|----------------|---------------------------------------------------------|
| 4     | `system_owner` | Everything, incl. the service-fee % split               |
| 3     | `principal`    | Companies, users below herself, tax rules               |
| 2     | `bookkeeper`   | Employees, hours, approve payroll                       |
| 1     | `site_payroll` | Enter & submit hours for their assigned company         |
| 0     | `employee`     | View own pay stub                                       |

Employees carry their own `clearance_level`; a user only sees records
with `clearance_level < their own`, so bookkeepers can't see the
records of principals or the owner.
