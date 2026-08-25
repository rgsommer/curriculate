# Qrewzi Rebrand & Launch Plan

**Scope:** Games-only rebrand. Extract the Live Sessions half of Curriculate into a
new brand and product at qrewzi.com. Curriculate keeps Pulse Grading, keeps
curriculate.net, keeps its Canadian trademark. Nothing about Pulse Grading changes.

**Split of responsibilities after launch:**

| Thing                          | Stays Curriculate | Becomes Qrewzi |
|--------------------------------|-------------------|----------------|
| Pulse Grading (AI grading)     | ✅                |                |
| curriculate.net marketing      | ✅ (Pulse only)   |                |
| Pulse Grading mobile app       | ✅                |                |
| Live Sessions / scavenger hunt |                   | ✅             |
| teacher-app dashboard          |                   | ✅             |
| student-app play surface       |                   | ✅             |
| "Curriculate Student" app      |                   | ✅ (renamed)   |
| Backend API                    | shared (same DB)  | shared         |
| Class rosters / progress       | shared            | shared         |

The backend and MongoDB stay one system; only the *presentation* splits into two
brands. This keeps class rosters + student progress data unified across both
products (which is the whole point).

---

## Phase 0 — Decisions & Brand Foundation (before code)

Things that block everything else. Do these first, in any order.

- [ ] **Wordmark & logo.** Qrewzi wordmark, monogram/icon mark, favicon set (16/32/apple-touch/512), OG image at 1200×630. If you want I can draft in-code SVGs.
- [ ] **Palette & type.** Pick 2 primary colors, 1 accent, 1 neutral. Font choice (Inter is safe; something more playful — Fraunces, Space Grotesk, Nunito — would signal the kid-facing pivot).
- [ ] **Tagline.** One line under the wordmark. "Class becomes a game." "The classroom game engine." "Learn on your feet." — needs to sit next to "Curriculate: AI grading for teachers" so the products differentiate at a glance.
- [ ] **Trademark filing.** CIPO application for "Qrewzi" (Nice classes 9 + 41 + 42). Optional US filing later. Ideally file before public launch.
- [ ] **Social handles.** Grab `@qrewzi` on TikTok, Instagram, X, YouTube, LinkedIn, Facebook. Do this today — nonsense words vanish fast.
- [ ] **Legal entity.** Decide whether Qrewzi is a DBA of your existing corp or a new subsidiary. Talk to your accountant; simplest is DBA.
- [ ] **App-store names.** Reserve "Qrewzi" and "Qrewzi Student" on both Google Play Console and App Store Connect. Reservations expire — do this within a couple weeks of launch.

## Phase 1 — Infrastructure (parallel with Phase 0)

- [ ] **DNS.** Move qrewzi.com nameservers to Cloudflare (same as curriculate.net presumably). Set apex A/AAAA/ALIAS records to your hosting.
- [ ] **Email.** Provision hello@, support@, noreply@, richard@ on qrewzi.com. Google Workspace or Fastmail. Set MX + SPF + DKIM + DMARC.
- [ ] **TLS.** Cert via hosting (Vercel/etc handle it automatically).
- [ ] **Subdomains.** Reserve `play.qrewzi.com` (student-app), `set.qrewzi.com` (teacher-app), `api.qrewzi.com` (optional — likely keeps `api.curriculate.net` since backend is shared).
- [ ] **Analytics.** New Google Analytics 4 property for qrewzi.com. New Search Console property. (Keep the existing Curriculate GA/Search-Console — they track different sites now.)
- [ ] **Resend / transactional email.** Verify qrewzi.com as a sending domain. New templates with Qrewzi branding.
- [ ] **Stripe.** Add Qrewzi as a brand on your Stripe account: logo, brand color, business name. New product line if Qrewzi has its own SKUs.

## Phase 2 — Marketing Site (qrewzi.com)

Two clean options; pick one:

**Option A (recommended): tiny new Next.js site**
- Fresh repo `qrewzi-web/`. 4-6 pages: home, features, pricing, about, contact, beta.
- Deploy separately (Vercel project #2, pointing at qrewzi.com).
- Zero risk of collateral damage to curriculate.net.
- ~1-2 weeks.

**Option B: same Next.js app, host-based routing**
- Keep one frontend/ codebase; use middleware to serve qrewzi routes when the host header is qrewzi.com and Curriculate routes when host is curriculate.net.
- Shared components stay shared.
- Faster in the long run, harder up-front. ~1 week if you're comfortable with Next.js middleware.

Pages the qrewzi.com site needs on day one:
- `/` — homepage with the "class becomes a game" pitch
- `/features` — 30+ task types, GameMaster mode, superpowers, device modes
- `/how-it-works` — 3-step teacher flow, screenshots
- `/pricing` — mirror the current pricing tiers under the new brand
- `/beta` — signup form (reuse existing `/beta` backend endpoint; just repoint origin)
- `/about` — the "why we built Qrewzi" story
- `/privacy` and `/terms` — legally required
- `/download` or hero CTAs → new app store listings

**Content work (biggest hidden cost):**
- Rewrite every string that says "Curriculate" → "Qrewzi" in the games context
- New screenshots of teacher-app + student-app with new branding
- Rewrite the About page — Qrewzi's story, not Curriculate's
- Rewrite blog posts / testimonials if they existed

## Phase 3 — App Code Rename

Global find-replace for "Curriculate" only in the game-side surfaces. Careful —
don't touch anything in `frontend/src/app/grading/*`, `frontend/src/app/pulse/*`,
or shared code that both products depend on.

### teacher-app/
- [ ] `<title>` in `index.html` and per-page titles
- [ ] All visible UI copy that says "Curriculate"
- [ ] Logo / wordmark asset swap (SVG in `src/assets/` or wherever)
- [ ] Favicon
- [ ] `package.json` name field (cosmetic; no npm publish anyway)
- [ ] Build banner / console message (search for `%c` styled logs)
- [ ] Any splash / loading screens

### student-app/
- [ ] Same list as teacher-app
- [ ] `main.jsx` console build stamp (`console.log("Curriculate student-app build…")`)
- [ ] Mobile-app splash + icon assets (see Phase 4)

### shared/
- [ ] Grep for the string "Curriculate" — most matters are in copy, not logic
- [ ] Do NOT rename npm package names or module paths if it will cascade into a giant PR — put those on a later cleanup pass

### backend/
- [ ] Email templates (session summary emails, welcome emails, reports)
- [ ] PDF report headers (the `Curriculate Report` header in the PDF you just showed)
- [ ] `pdfReports.js` — footer text
- [ ] Any hardcoded absolute URLs pointing at `curriculate.net` that should point at `qrewzi.com` for game flows

### frontend/
- [ ] Only if you go with Option B above; otherwise this directory changes little.
- [ ] If Option A: rip the games-marketing pages out (or leave them dying under a `/legacy-*` route for 30 days then delete).

**Ordering constraint:** don't touch the copy until Phase 0 lands the logo + palette, or you'll do it twice.

## Phase 4 — Mobile Apps

Rename the existing "Curriculate Student" app to "Qrewzi." This is an *update*
of the existing listing, not a new listing — you keep the ratings, reviews, and
install base.

**Critical:** per your project memory, Android updates MUST sign with
`pulse-grading-keystore.jks` (the registered Play upload key). Do NOT switch
keystores — the update will be rejected. This applies even though we're
rebranding.

- [ ] **Icon.** New adaptive icon (foreground SVG + background color) for Android. 1024×1024 icon for iOS.
- [ ] **Splash.** New splash SVG.
- [ ] **App name.** `capacitor.config.ts` → change `appName`. `strings.xml` on Android → change `app_name`. `Info.plist` on iOS → change `CFBundleDisplayName`.
- [ ] **Bundle ID / package name.** LEAVE UNCHANGED. Changing it means a new listing = losing all installs and reviews. Update the *display name* only.
- [ ] **Live URL in capacitor.config.ts.** Point at the Qrewzi student surface (`play.qrewzi.com`), not `curriculate.net/grading?app=1`.
- [ ] **Play Store listing.** Update title, short + full description, screenshots, feature graphic, promo video.
- [ ] **App Store listing.** Same.
- [ ] **Version bump + submit.** Android: signed AAB via the pulse-grading keystore. iOS: TestFlight → App Store review.

Expect 2-7 days for review (both stores).

## Phase 5 — Launch Day

Ordered ceremony. Do it on a low-traffic day (Tuesday-Thursday morning).

1. [ ] Point qrewzi.com DNS at hosting (should already be done from Phase 1)
2. [ ] Deploy qrewzi.com marketing site
3. [ ] Deploy renamed student-app to play.qrewzi.com and teacher-app to set.qrewzi.com
4. [ ] Set up 301 redirects on curriculate.net for former games routes:
   - `curriculate.net/features` → `qrewzi.com/features` (only if the old features page was games-focused; if it was mixed, this is a judgment call — you may want to keep a Pulse-only /features on curriculate.net)
   - `play.curriculate.net/*` → `play.qrewzi.com/*` (path-preserving)
   - `teacher.curriculate.net/*` → `set.qrewzi.com/*`
5. [ ] Search Console: submit a change-of-address for the games subdomains
6. [ ] Ship the mobile-app update (already reviewed by this point)
7. [ ] Email existing users: "we've renamed the games side to Qrewzi — nothing else changes, your login and data stay put"
8. [ ] Update social bios, LinkedIn company page, TikTok
9. [ ] Publish launch post on the blog and cross-post to all social
10. [ ] Update any external directory listings (edtech aggregators, product hunt page if applicable)

## Phase 6 — Post-Launch Monitoring (first 2 weeks)

- [ ] Watch 404 logs on curriculate.net for redirects you missed
- [ ] Watch Search Console for crawl errors on both properties
- [ ] Watch Play Store + App Store review inbox for confused-user reviews
- [ ] Monitor Stripe for any subscription hiccups
- [ ] Monitor Resend deliverability (new sending domain has zero reputation on day 1 — warm it up)

## Phase 7 — Legacy Cleanup (30-60 days out)

- [ ] Delete unused games routes from frontend/
- [ ] Delete unused games components from shared/ (or leave — they still power qrewzi backend)
- [ ] Retire any old assets in the repo
- [ ] Take down redirects that have no traffic (leave the popular ones forever)

---

## Risks & Non-Obvious Costs

- **SEO reset.** Qrewzi starts at zero domain authority. Expect 3-6 months to
  rank for anything. 301s carry authority forward but only for existing URLs;
  the brand name itself needs to earn its ranking.

- **Existing user confusion.** Anyone who bookmarked play.curriculate.net or
  teacher.curriculate.net gets confused. 301s fix the URL, but the app name
  changing on their home screen (mobile) is jarring — that's what the launch
  email is for.

- **Two-brand overhead.** Two websites, two social presences, two brand
  guidelines, two Play Store listings (Pulse Grading stays; Qrewzi is renamed
  student app). You just doubled the marketing surface area. Worth it if the
  clarity gain (kid-friendly game brand vs. teacher grading brand) outweighs
  the operational cost.

- **Backend URL sprawl.** Anywhere the backend generates a link (session invite
  URLs, PDF report URLs, email links) needs a decision: does it link to
  qrewzi.com or curriculate.net? Rule of thumb: game flows → qrewzi, grading
  flows → curriculate. Enforce with a helper like `linkFor("game" | "grade", path)`.

- **Reviews and testimonials.** Any social proof that names "Curriculate" is
  now split-brand — for the games product it reads oddly. Consider a testimonials
  refresh once you have a few Qrewzi-labeled quotes.

- **Trademark gap.** Between the CIPO filing and issuance, you have limited
  protection. Prioritize filing before any big launch push.

- **App store rejection risk.** Renaming an existing app usually goes through
  review with no drama, but Apple can be picky if the icon changes too much
  from what they approved. Have a fallback icon that's clearly evolved from
  the current one.

---

## Time Estimate (solo, focused)

- Phase 0: 3-5 days (a lot of it is waiting on TM filing)
- Phase 1: 1-2 days
- Phase 2: 1-2 weeks
- Phase 3: 3-5 days (mostly copy sweep + asset swap)
- Phase 4: 2-3 days work + 2-7 days review wait
- Phase 5: 1 day
- Phase 6-7: ongoing background

**Realistic end-to-end: 4-6 weeks** from decision to fully-rebranded, with
launch around week 4 and Phase 6-7 running in parallel.

## What I Can Take On Right Now

If you want to start executing, low-risk first bites:

1. Draft the Qrewzi wordmark + logo as SVG (Phase 0)
2. Register `play.qrewzi.com` + `set.qrewzi.com` DNS if hosting is Vercel/Cloudflare (Phase 1)
3. Scaffold the `qrewzi-web/` Next.js repo with a homepage draft (Phase 2)
4. Grep the codebase and produce a change list of every "Curriculate" string in the game-side surfaces (Phase 3 discovery)
5. Draft the launch email + social post copy (Phase 5)

Any of these are single-session tasks. Say the word.
