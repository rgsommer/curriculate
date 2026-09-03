# Behaviours — Edsby Cookie Sync

A small Chrome/Edge/Vivaldi extension that keeps your Edsby session cookie
synced to the Behaviours app, so parent notices keep posting through Edsby
without you re-pasting the cookie by hand.

It works for **any** school on the hosted Behaviours app — everyone uses the
same ingest endpoint (`api.curriculate.net`); only your Edsby subdomain and your
school's ingest token differ, and both are entered on the options page.

## Why an extension?

Browsers deliberately block one website from reading another website's session
cookie (it's HttpOnly + cross-origin) — that's what stops a malicious site from
stealing your logins. A browser **extension** with the `cookies` permission is
the sanctioned exception: it can read the cookie locally and push it where you
tell it. The cookie is sent **only** to the ingest URL you configure.

## Install (load unpacked)

1. Unzip this folder somewhere permanent.
2. Open `chrome://extensions` (or `edge://extensions`, `vivaldi://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.

## Configure

1. In Behaviours: **Setup → Edsby → “Auto-push from your own browser script” →
   Generate token**. Copy the token.
2. Open the extension's **Options** (right-click the extension → Options, or via
   the extensions page → Details → Extension options).
3. Enter:
   - **Your Edsby host** — e.g. `yourschool.edsby.com`
   - **Behaviours ingest token** — the token you copied
4. Click **Save**, then **Push current cookie now** to test. You should see
   `{"ok":true,"updated":["cookie", ...]}`.

## What it does

- Pushes the cookie immediately whenever Edsby refreshes it (login / renewal).
- Observes Edsby's own outgoing requests (read-only) to capture the
  `x-xds-jver` / `x-xds-cver` headers — the only place Edsby exposes the bundle
  version — plus the `_formkey` from form posts, and sends them with the cookie.
  So the app gets jver/cver/formkey automatically, no manual entry.
- Re-pushes every 30 minutes as a safety net.
- Click the toolbar icon any time to push on demand (badge shows OK/ERR).

## Privacy / security

- The cookie is sent only to the ingest URL (default the hosted Behaviours
  backend). Nothing is sent anywhere else.
- The ingest token is the credential — keep it private. Regenerating it in
  Behaviours immediately revokes the old one; update the extension's options
  with the new token.

## Multiple ingest targets (v1.3.0)

The **Ingest URL** field on the options page now takes **one URL per line**, and
every line receives the same push. Blank still means the hosted endpoint.

This exists because the cookie has more than one consumer. The extension used to
feed only the Behaviours backend, so anything else reading Edsby with a stored
cookie — e.g. the Bdays spreadsheet in
`../edsby-bdays-apps-script/` — drifted out of date silently and failed with
Edsby error 1030 `no links to node`, which looks nothing like an expired
session.

### Adding a Google Sheet as a target

1. In the sheet's Apps Script project, add a Script Property
   `EDSBY_INGEST_TOKEN` with a long random value.
2. **Deploy → New deployment → Web app**, Execute as **Me**, Access
   **Anyone**. Copy the `/exec` URL.
3. Add this as a second line in the Ingest URL field:
   `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?token=<TOKEN>`
4. Save, then click the toolbar button to push immediately.

The token rides in the **query string** because Apps Script web apps cannot read
custom request headers — `x-ingest-token` never reaches `doPost`. Anyone holding
that URL can write those script properties, so treat it like a password; to
revoke, change the property and redeploy. The URL is masked in the extension's
"Last push" log (`?token=***`).

`host_permissions` now includes `script.google.com` and
`script.googleusercontent.com`; an MV3 service worker cannot POST to a host it
lacks permission for, so **reload the unpacked extension** after updating.

### Notes

- `readCookieHeader()` sends the **whole** Cookie header for the Edsby host, not
  just `session_id_edsby` — matching a manual DevTools copy.
- A push reports per-target results; `failedTargets` is non-zero if any line
  failed, so one broken target does not hide the others.
- Only `https://` lines are accepted. Anything else is ignored, and if no line
  survives, the default endpoint is used.

## Tests

```
node extensions/behaviours-edsby-cookie-sync/test-ingest.cjs
```

32 assertions over the fan-out parsing, token masking, and the Apps Script
receiver (`applyIngest_`, `constantTimeEquals_`). No Chrome or Apps Script
runtime needed.
