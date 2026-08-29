# Qrewzi Mobile Launch Runbook

Ships the two rebranded native apps as **UPDATES** to the existing store listings:

| App                     | Store name (was → is)              | Bundle ID / appId              | Version bump         |
|-------------------------|------------------------------------|--------------------------------|----------------------|
| `mobile-app-student/`   | Curriculate Student → **Qrewzi**   | `net.curriculate.student`      | 1.1 (code 4) → **2.0 (code 5)** |
| `mobile-app-curriculate/` | Curriculate → **Qrewzi Teacher** | `net.curriculate.sessions`     | 1.0 (code 1) → **2.0 (code 2)** |

`appId` / `Bundle ID` **do not change** — that preserves install lineage, ratings, and the pulse-grading-keystore.jks signing key registration on Play. Users on the old "Curriculate Student" app will see the icon and name flip to "Qrewzi" on their next update.

---

## Pre-flight — what I already did

- ✅ `capacitor.config.ts` in both apps: `appName` and live-URL swapped to Qrewzi
- ✅ `package.json` names + descriptions + `cap:init` scripts renamed to Qrewzi
- ✅ `src/native-bridge.js` `APP_HOST` swapped (`play.qrewzi.com`, `set.qrewzi.com`)
- ✅ Offline fallback pages point at Qrewzi hosts
- ✅ SUBMISSION.md + APP-STORE-LISTING.md + store-metadata.md rewritten for Qrewzi
- ✅ Student app icon: Qrewzi coral+cream (was already updated)
- ✅ Teacher app icon: Qrewzi coral-on-navy (I generated + placed today — was the old Crue fox)
- ✅ Android `signingConfigs.release` in both `app/build.gradle` (teacher app just added; student had it)
- ✅ Version bumps: student `2.0 (5)`, teacher `2.0 (2)`

## What YOU need to do — in order

### 1. Locate the keystore + set env vars

```bash
# Where you keep the keystore. NOT in the repo — never commit .jks files.
export KEYSTORE_FILE=/path/to/pulse-grading-keystore.jks
export KEYSTORE_PASSWORD='...'
export KEY_ALIAS='...'
export KEY_PASSWORD='...'
```

Put these in `~/.zshrc` or a `.env.local` (gitignored) so subsequent builds pick them up automatically. If you don't remember the passwords, they're the ones you set when you created the keystore originally — likely in your password manager under "Play Console" or "pulse-grading-keystore".

### 2. Regenerate platform icons + splashes

Both apps use `capacitor-assets` to build every needed size (Android adaptive icon foreground/background, iOS AppIcon.appiconset variants, splash densities). The source art already exists in each app's `assets/` folder.

```bash
# Student app
cd mobile-app-student
npx capacitor-assets generate \
  --iconBackgroundColor '#FF4D5B' \
  --splashBackgroundColor '#FEF9F0' \
  --splashBackgroundColorDark '#0B1F3A'
npx cap sync

# Teacher app
cd ../mobile-app-curriculate
npx capacitor-assets generate \
  --iconBackgroundColor '#0B1F3A' \
  --splashBackgroundColor '#FEF9F0' \
  --splashBackgroundColorDark '#0B1F3A'
npx cap sync
```

Skip this if you're happy with the current on-device icon appearance (Xcode/AS will pick up `assets/icon.png` on next sync regardless).

### 3. iOS — bump version, archive, upload

Do this once per app.

```bash
cd mobile-app-student   # (then repeat for mobile-app-curriculate)
npm run cap:sync
npm run cap:open:ios    # opens Xcode
```

In Xcode:
1. Select the **App** target → **General** tab
2. Set **Version** to `2.0` and **Build** to `5` (student) / `2` (teacher)
3. Select **Signing & Capabilities** → confirm Team is **Applicable Software Inc**
4. Choose destination **Any iOS Device (arm64)** at the top
5. **Product → Archive** — waits ~1–3 min
6. In the Organizer window that opens: **Distribute App → App Store Connect → Upload**
7. Notarization runs on Apple's end (~5–15 min); an email tells you when the build is available in App Store Connect

### 4. Android — build signed AAB, upload

```bash
cd mobile-app-student   # then mobile-app-curriculate
cd android
./gradlew bundleRelease
# Output: android/app/build/outputs/bundle/release/app-release.aab
```

Play Console → your app → Release → Production → Create new release → upload `app-release.aab`.

### 5. Store listing updates (both stores, both apps)

Everything you need to paste is already drafted:

- **Student app** — App Store: `mobile-app-student/APP-STORE-LISTING.md` · Play: `mobile-app-student/store-metadata.md`
- **Teacher app** — Both stores: `mobile-app-curriculate/store-metadata.md` + `SUBMISSION.md`

Update on each store:
- App name → **Qrewzi** (student) or **Qrewzi Teacher** (teacher)
- Subtitle / short description
- Full description
- Screenshots (see next section)
- App icon (Play Store field takes 512×512; App Store pulls from the binary)
- Feature graphic (Play only, 1024×500)
- What's new in this version — draft below

**"What's new" copy for both apps:**

```
We're now Qrewzi! Same app, sharper focus on classroom games.

• Fresh coral + navy look
• Everything you already loved, just under our new name
• Room codes and existing sessions keep working

Come play at qrewzi.com.
```

### 6. Screenshots (blocker — needs a real device or simulator)

Both listings need **new** screenshots showing Qrewzi branding. You'll want:

**Student app (both stores)** — 4–6 shots:
- Join screen with room code entry
- A task type mid-play (e.g. Multiple Choice)
- Live leaderboard
- Motion Mission or another movement task
- QR-scanner scanning a station

**Teacher app (both stores)** — 4–6 shots:
- GameMaster projector dashboard with a live session
- Task-set generator (describe-a-lesson prompt)
- Live leaderboard on projector
- Station heat map
- (iPad landscape) Session dashboard

Fastest way to capture:
1. Boot the iOS Simulator (iPhone 15 Pro or 6.7"/6.9" required by App Store) OR run the Capacitor app on a real device
2. Point WebView at `play.qrewzi.com` / `set.qrewzi.com` (make sure the web deploys are live first)
3. `Cmd+S` in Simulator → captures to Desktop
4. Both stores auto-detect dimensions; upload each device size separately

For **Play Store tablet screenshots** and **Apple iPad screenshots** — same idea, different simulator. App Store REQUIRES iPad screenshots if the app supports iPad (which yours does).

### 7. App Review — expect 2–7 days

- **Apple:** usually 24–48h for updates. Rejections in your history have been 2.3.10 (metadata) and 2.1(b) (business model) — both have standing answers in `mobile-app-student/APP-STORE-LISTING.md § 6`.
- **Play:** usually 1–3 days for updates; longer for the first submission with a big rename since the AI reviewer flags the app-name change.

### 8. Post-approval — release

- **Play:** if you uploaded to Production, it releases as soon as review approves
- **Apple:** after approval, choose **Manual release** or **Automatic release** in App Store Connect

---

## Things that can go wrong

- **`bundleRelease` builds unsigned AAB.** Check `KEYSTORE_FILE` is set in the shell that ran `./gradlew`. The signing block is env-var-gated.
- **Play Console: "Upload failed — signed with the wrong certificate."** You used a different keystore than the one first registered with Play. There is no fix — you MUST sign with `pulse-grading-keystore.jks`. If you lost it, contact Play support to reset the upload key (Play retains the app signing key, so users' installs stay valid; only the upload key rotates).
- **Xcode: "No provisioning profile."** Team not set on the target, or the App ID isn't yet registered on developer.apple.com. Register `net.curriculate.student` and `net.curriculate.sessions` if they're not there.
- **App Store rejection 2.3.10:** description references Android. Fix: remove any Android mentions from the Apple listing.
- **App Store rejection 2.1(b):** business model unclear. Standing answer in APP-STORE-LISTING.md § 6.
- **User reviews confused by rename** ("What happened to Curriculate Student?"). The "What's new" copy above explicitly addresses this. Consider a pinned in-app banner on first launch after update — optional Phase 2 work.

## Order of operations (recommended)

Best not to fire both apps at both stores simultaneously — if something goes wrong you don't want to firefight four review queues. Suggested pacing:

1. **Day 1** — Student app to Play (Internal testing track first, then Production)
2. **Day 1** — Student app to App Store TestFlight
3. **Day 1–2** — smoke test the student AAB internally, promote to Play Production
4. **Day 2** — Teacher app to Play Internal testing
5. **Day 2** — Teacher app to App Store TestFlight
6. **Day 3+** — promote Teacher to Production when Student is stable

Or ship both at once if you're comfortable — I'll flag it, you decide.
