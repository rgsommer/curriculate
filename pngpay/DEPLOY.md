# Deploying PNGPay to www.curriculate.net/pngpay

PNGPay is a Node.js + SQLite app. The plan is to run it as a process on the
curriculate.net server and have nginx proxy `/pngpay` to it.

## 1. Prerequisites on the server

- Node.js 18 or newer (`node -v`)
- nginx already serving https://www.curriculate.net
- A Resend account (https://resend.com) with the sending domain verified.
  Get an API key from Resend > API Keys.

## 2. Upload the code

```bash
# from your laptop
rsync -avz --exclude node_modules --exclude .env --exclude data ./PNGPay/ \
  user@curriculate.net:/var/www/pngpay/
```

Or, from a fresh server:

```bash
ssh user@curriculate.net
cd /var/www && git clone <your-repo-url> pngpay  # or upload by sftp
cd pngpay && npm ci
```

## 3. Environment

```bash
cp .env.example .env
nano .env
```

Set at minimum:

```
BASE_PATH=/pngpay
PUBLIC_URL=https://www.curriculate.net/pngpay
PORT=3000                   # any free port
SESSION_SECRET=<paste a 64-char random string>
RESEND_API_KEY=re_...
EMAIL_FROM="PNGPay <payroll@curriculate.net>"
BOOTSTRAP_SUPER_ADMIN_EMAIL=rgsommer@me.com
BOOTSTRAP_SUPER_ADMIN_PASSWORD=<a strong password — you'll change it on first login>
NODE_ENV=production
```

## 4. First-time database init

```bash
npm run migrate    # creates data/pngpay.db
npm run smoke      # sanity check, prints "All smoke checks passed."
```

(Optional) demo data so you can poke around before importing real employees:

```bash
npm run seed
```

## 5. Run with PM2 (auto-restart on crash, starts on reboot)

```bash
sudo npm install -g pm2
pm2 start server.js --name pngpay
pm2 save
pm2 startup    # follow the printed instruction once
```

Check it's listening: `curl -I http://127.0.0.1:3000/pngpay/login`

## 6. nginx reverse proxy

Add this inside your existing `server { listen 443 ssl; server_name www.curriculate.net; ... }` block:

```nginx
location /pngpay/ {
    proxy_pass         http://127.0.0.1:3000/pngpay/;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Real-IP         $remote_addr;
    client_max_body_size 10m;
}
```

Reload nginx: `sudo nginx -t && sudo systemctl reload nginx`.

Open https://www.curriculate.net/pngpay/login and log in with the bootstrap
credentials you set in `.env`. Change the password from the Admin → Users
page immediately, then unset `BOOTSTRAP_SUPER_ADMIN_PASSWORD` in `.env`.

## 7. First-run setup checklist

In order:

1. **Admin → Companies → Add company** for each entity (e.g. one per legal
   business). Tax rules with PNG defaults are auto-seeded.
2. **Admin → Companies → Open → Company information** — fill in bank
   account, BSP client number, NCSL employer number, office/manager emails,
   pay-slip message. These flow into the BSP batch and NASFund returns.
3. **Admin → Users → Add user** for the company admin and payroll admin
   for each company. They will log in directly.
4. **Admin → Bulk import** — paste the "PNGPay Bulk Employees" CSV to
   create employees in bulk. Or add them one by one from **Employees → New**.
5. **Tax rules** — check the JSON defaults against the latest IRC
   fortnightly tables. Save a new version when bands change in a budget.

## 8. Backups

The database is a single file at `data/pngpay.db`. Back it up nightly:

```bash
# in crontab
0 2 * * * sqlite3 /var/www/pngpay/data/pngpay.db ".backup /backups/pngpay-$(date +\%F).db"
```

## 9. Updating the app

```bash
ssh user@curriculate.net
cd /var/www/pngpay
git pull            # or rsync new files
npm ci
npm run migrate     # idempotent
pm2 restart pngpay
```

## Where to edit business logic

- **Tax brackets / Nasfund rates / custom deductions** — `src/payroll.js`
  (defaults) AND/OR the Tax Rules tab in the UI (per company).
- **CSV columns** — `src/csv.js`.
- **BSP batch file format** — `src/bsp.js`.
- **NASFund return columns** — `src/nasfund.js`.
- **Pay-stub email layout** — `src/email.js` (`stubHtml`).
