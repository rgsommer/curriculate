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
- Re-pushes every 30 minutes as a safety net.
- Click the toolbar icon any time to push on demand (badge shows OK/ERR).

After the cookie lands, the Behaviours app's **Refresh from Edsby** button takes
care of jver/cver and the short-lived formkey.

## Privacy / security

- The cookie is sent only to the ingest URL (default the hosted Behaviours
  backend). Nothing is sent anywhere else.
- The ingest token is the credential — keep it private. Regenerating it in
  Behaviours immediately revokes the old one; update the extension's options
  with the new token.
