# Launching PNGPay at www.curriculate.net/pngpay

PNGPay is a stateful Node app. curriculate.net (Vercel/Netlify/Cloudflare
Pages) is *not* a stateful host, but it can transparently proxy a path
to one. We deploy PNGPay to Render (you already have MongoDB there) and
add a 5-line rewrite to curriculate.net so the URL stays the same.

Total cost on low traffic: **$0/month**. Render's free Web Service tier
+ your existing MongoDB + curriculate.net unchanged.

Estimated time: ~15 minutes.

## What you need before starting

- [ ] The repo pushed to GitHub (private is fine). Render deploys *from* a
      GitHub repo, so we need a remote.
- [ ] Your **MongoDB connection string** (Render dashboard → your
      Mongo service → "Internal Connection String" or "External
      Connection String" — use the External one for now, you can switch
      to internal after both services are in the same region).
- [ ] A **Resend** account at https://resend.com with the sending
      domain `curriculate.net` verified. Copy an API key.

## Step 1 — Get the code into your GitHub repo

PNGPay is designed to live inside the existing Curriculate repo as a
subdirectory. (You can also give it a dedicated repo later — see "Moving
PNGPay to its own repo / domain" at the bottom.)

```bash
# 1a. Pull the Curriculate repo locally if you don't have it
cd ~/Documents/Claude/Projects
git clone git@github.com:YOUR-USER/curriculate.git
cd curriculate

# 1b. Move PNGPay in as a subfolder
cp -r ~/Documents/Claude/Projects/PNGPay ./pngpay

# 1c. Commit + push
git add pngpay
git commit -m "Add PNGPay (multi-tenant payroll service)"
git push
```

`render.yaml` already has `rootDir: pngpay` so Render knows to build out of
the subfolder. The Curriculate marketing site at the repo root is
unaffected.

## Step 2 — Deploy to Render

1. Open https://dashboard.render.com → **New** → **Blueprint**.
2. Connect the **Curriculate** GitHub repo (Render will detect the
   `pngpay/render.yaml` blueprint).
3. Render reads `render.yaml` and shows the service it will create
   (root directory: `pngpay`). Click **Apply**.
4. When prompted, fill in these env vars in the dashboard:
   - `MONGO_URI` — **paste the same value you already use for Curriculate**.
     PNGPay writes to a separate database (`MONGO_DB=pngpay`) on the same
     cluster, so it can't collide with curriculate's collections.
   - `MONGO_DB` — `pngpay` (already pre-filled by render.yaml).
   - `RESEND_PNGPAY_API_KEY` — from resend.com (kept separate from any
     RESEND_API_KEY used by Curriculate so the keys can rotate independently).
   - `EMAIL_FROM` — e.g. `PNGPay <payroll@curriculate.net>`.
   - `BOOTSTRAP_SUPER_ADMIN_EMAIL` — `rgsommer@me.com`.
   - `BOOTSTRAP_SUPER_ADMIN_PASSWORD` — pick a strong one; you'll change
     it on first login.
   - `SESSION_SECRET` — leave blank; Render auto-generates.
5. Click **Create Web Service**. First build takes ~3 min.

When it goes green, the service has a URL like
`https://pngpay.onrender.com`. Open `https://pngpay.onrender.com/pngpay/login`
in a browser — you should see the PNGPay sign-in. Log in with the
bootstrap email + password, then go to **Admin → Users** and change
your password. After that, go back to Render and **unset**
`BOOTSTRAP_SUPER_ADMIN_PASSWORD` so it's never used again.

## Step 3 — Make https://www.curriculate.net/pngpay route to it

Pick the snippet that matches the host curriculate.net runs on.

### If curriculate.net is on Vercel

Open (or create) `vercel.json` at the root of the curriculate.net repo
and merge in:

```json
{
  "rewrites": [
    { "source": "/pngpay",        "destination": "https://pngpay.onrender.com/pngpay" },
    { "source": "/pngpay/:path*", "destination": "https://pngpay.onrender.com/pngpay/:path*" }
  ]
}
```

Commit + push. Vercel redeploys curriculate.net in ~30 seconds.

### If curriculate.net is on Netlify

Append to `netlify.toml`:

```toml
[[redirects]]
  from = "/pngpay/*"
  to   = "https://pngpay.onrender.com/pngpay/:splat"
  status = 200    # rewrite, not redirect — URL stays as curriculate.net
  force  = true
```

### If curriculate.net is on Cloudflare Pages

Create or edit `_redirects` at the project root:

```
/pngpay/*  https://pngpay.onrender.com/pngpay/:splat  200
```

## Step 4 — Verify

```bash
curl -I https://www.curriculate.net/pngpay/login
# → HTTP/2 200, content-type: text/html
```

Open `https://www.curriculate.net/pngpay/login` in a browser. Sign in.

## Step 5 — First-time setup inside the app

1. **Admin → Companies → Add company** for each legal entity.
2. **Admin → Companies → Open → Company information** — fill in
   bank account, BSP client number, NCSL employer number,
   payroll-officer name/email, pay-slip message text.
3. **Admin → Users → Add user** for each company admin and
   payroll admin.
4. **Admin → Bulk import** — paste the "PNGPay Bulk Employees" CSV
   to create employees in bulk.
5. **Tax rules** — confirm the SWT brackets and Nasfund rates
   against the current IRC table. Save a new version when bands change.

## Step 6 — Each fortnight

1. **Payroll → New pay period** — set period dates, double-click the
   *hours* cell on each row to fill the employee's default (double-click
   again to zero out for "didn't work"), add cash advances or notes.
2. Click **Confirm payroll & send stubs**. Pay stubs go out via Resend;
   the CSV is emailed to the company admin and stored on the period.
3. **Download BSP batch** from the period page, upload to BSP Batch
   Manager. If BSP rejects the first-line date, open the CSV in a plain
   text editor (not Word) and adjust.
4. **Admin → NASFund** download for the period when filing monthly.

## Free-tier note

Render's free Web Service tier sleeps after ~15 min of inactivity.
First request after a sleep takes ~30 seconds while it spins up. For a
fortnightly-use app this is fine; if it ever becomes annoying, upgrade
the Render service to **Starter** ($7/mo) to keep it always-on.

## Future updates

```bash
# locally
git add -A && git commit -m "..." && git push
# Render auto-deploys in ~2 minutes. Zero downtime.
```

## Migrating data out later

Everything is in your MongoDB. `mongodump` against the connection string
gets you a full backup; `mongorestore` puts it anywhere.

## Moving PNGPay to its own repo / domain

When you outgrow the monorepo arrangement — say PNGPay needs its own
release cadence, or you want **pngpay.com** or **pngpay.curriculate.net**:

1. **New repo**: `git filter-repo --subdirectory-filter pngpay` to keep
   only the PNGPay history, then push to a new GitHub repo. Or just
   copy the folder over and start fresh.
2. **Render**: open the existing service, change the GitHub repo and
   remove the `rootDir: pngpay` line from `render.yaml`. Render
   redeploys without losing the live URL or env vars.
3. **Domain (optional)**: in Render → Settings → Custom Domains, add
   `pngpay.curriculate.net` (or any domain). Render gives you a CNAME
   target. Add the CNAME in your DNS provider.
4. **Curriculate rewrite**: either delete the `/pngpay` rewrite (if the
   new URL is the canonical one) or leave it so old links keep working.

No database migration. No data export. No code changes. The connection
string still points at the same MongoDB.
