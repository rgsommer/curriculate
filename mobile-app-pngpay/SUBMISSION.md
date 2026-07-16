# PNGPay — Store Submission Runbook (iOS + Android)

Execute top-to-bottom. Every command and every form answer is pre-filled.
Companion files: `store-metadata.md` (listing copy), `SETUP.md` (architecture),
`android/keystore.properties.example` (signing template).

| Field | Value |
|-------|-------|
| App name | **PNGPay** |
| Bundle ID / applicationId | `net.curriculate.pngpay` |
| Version (marketing) | `1.0` |
| Build number / versionCode | `1` |
| Loads (live URL) | `https://www.curriculate.net/teebeepay/app?app=1&view=team` |
| Sign-in | Email + one-time PIN (first-party; no social login) |
| Push / camera / location | **None** (cut from v1) |

**Accounts you need:** Apple Developer ($99/yr) · Google Play Developer ($25 one-time).

---

## 0. Pre-flight (already done — verify)

- [x] Demo supervisor seeded in prod DB `curriculate` (`reviewer@teebeeaccountants.com.pg`)
- [x] Server env vars `DEMO_REVIEW_EMAIL` + `DEMO_REVIEW_PIN=246810` set → demo sign-in confirmed working
- [x] Push cut; Android manifest carries no notification permission
- [x] Release signing wired in `android/app/build.gradle`

> ⚠️ The review PIN in `store-metadata.md` (`246810`) MUST equal the server's
> `DEMO_REVIEW_PIN`. If you change one, change both.

---

## 1. One-time local setup (both platforms)

```bash
cd mobile-app-pngpay
npm install
npm run build:web          # regenerates www/
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8   # fixes the CocoaPods encoding crash
npx cap sync               # syncs web assets + plugins into ios/ and android/
```

If `npx cap sync` still fails on the iOS `pod install` step, run Android-only
now (`npx cap sync android`) and fix Pods before the iOS section:
```bash
sudo gem install cocoapods   # or: brew reinstall cocoapods
cd ios/App && pod install && cd ../..
```

---

## 2. ANDROID — Google Play

### 2.1 Generate the upload keystore (once; back it up forever)

```bash
cd mobile-app-pngpay/android
keytool -genkey -v -keystore pngpay-upload-key.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias pngpay
```
Answer the prompts (name/org/country = PG). Choose a strong store & key password.
**Back up `pngpay-upload-key.jks` + both passwords** (password manager). It is
git-ignored on purpose. With Play App Signing (default) this is your *upload*
key — recoverable via Play Console if lost, but treat it as precious.

### 2.2 Point the build at the keystore

```bash
cp keystore.properties.example keystore.properties
```
Edit `keystore.properties`:
```
storeFile=pngpay-upload-key.jks
storePassword=<your store password>
keyAlias=pngpay
keyPassword=<your key password>
```

### 2.3 Build the signed AAB

```bash
cd mobile-app-pngpay/android
./gradlew bundleRelease
# output: android/app/build/outputs/bundle/release/app-release.aab
```
(GUI alternative: `npx cap open android` → Build → Generate Signed App Bundle.)

### 2.4 Smoke-test the release build on a real device — DO NOT SKIP

A sibling app was rejected for a launch crash ("Broken Functionality").
```bash
# build a signed APK just for device testing:
./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```
Launch it, sign in with the demo account, view team → enter hours → submit.
Confirm no crash and the live app loads over HTTPS.

### 2.5 Create the app in Play Console

Play Console → **Create app**:
- App name: **PNGPay**
- Default language: English (United States) – en-US
- App or game: **App**
- Free or paid: **Free**
- Declarations: confirm Developer Program Policies + US export laws.

### 2.6 Main store listing (paste-ready)

| Field | Value |
|-------|-------|
| App name | `PNGPay` |
| Short description (80) | `Supervisors submit team hours & leave on the go. Bookkeeper approves & pays.` |
| Full description | *(paste the "Full Description" block from `store-metadata.md`)* |
| App icon | 512×512 (from `resources/icon.png`) |
| Feature graphic | `resources/feature-graphic.png` (1024×500) |
| Phone screenshots | ≥ 2 (see §4) |
| App category | Business |
| Tags | payroll, timesheet, productivity |
| Contact email | `info@teebeeaccountants.com.pg` |
| Contact website | `https://www.curriculate.net/teebee` |
| Privacy policy | `https://www.curriculate.net/privacy` |

### 2.7 Data safety form — exact answers

- Does your app collect or share required user data? **Yes**
- Is all data encrypted in transit? **Yes**
- Do you provide a way to request data deletion? **Yes** →
  URL `https://www.curriculate.net/contact` (accounts are admin-provisioned;
  deletion handled by the account administrator on request).

Data types collected (all: collected = Yes, shared = No, processed = not
ephemeral, **linked to user = Yes**, used for tracking = **No**):

| Category → Type | Purpose |
|-----------------|---------|
| Personal info → **Email address** | Account management, App functionality |
| Personal info → **Name** | Account management, App functionality |
| Personal info → **Other info** (hours & leave entered for the pay period) | App functionality |

Everything else (location, financial, photos, contacts, messages, files,
calendar, health, device IDs, app activity, web history) = **not collected**.

### 2.8 Content rating (IARC questionnaire)

- Category: **Utility, Productivity, Communication, or Other**
- Answer **No / None** to every content question (violence, sexual, language,
  controlled substances, gambling, user-generated content sharing, etc.)
- Result: rated **Everyone / PEGI 3**.

### 2.9 App content declarations

- Target audience: adults (18+ work context) — not designed for children.
- Ads: **No ads.**
- Government app: No. Financial features: it's a payroll data-entry tool, not a
  bank; declare no in-app trading/lending. News app: No. COVID app: No.

### 2.10 Release

1. **Testing → Internal testing** → Create release → upload
   `app-release.aab` → add yourself/testers → roll out → install via the opt-in
   link and re-verify the demo flow.
2. **Testing instructions** (for Google reviewers), paste:
   > Account-gated app. Demo supervisor: `reviewer@teebeeaccountants.com.pg`,
   > fixed PIN `246810`. Open, sign in, view team → enter hours → submit.
3. **Production → Create release** → reuse the same AAB → submit for review.

---

## 3. iOS — App Store

### 3.1 Sync (Pods fixed)

```bash
cd mobile-app-pngpay
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
npx cap sync ios
npx cap open ios       # opens App.xcworkspace in Xcode
```

### 3.2 Xcode signing + version

In Xcode → target **App** → **Signing & Capabilities**:
- Team: your Apple Developer team
- Automatically manage signing: **On**
- Bundle Identifier: `net.curriculate.pngpay`
- Do **not** add Push Notifications capability (cut from v1).

Target **App → General**:
- Display Name: `PNGPay`
- Version (Marketing): `1.0`
- Build (Current Project Version): `1`
- Deployment target: iOS 14+ (Capacitor 6 default is fine).

### 3.3 Archive + upload to TestFlight

- Xcode top bar: device target = **Any iOS Device (arm64)**
- Menu: **Product → Archive**
- Organizer opens → **Distribute App → App Store Connect → Upload**.
- Wait for the build to finish processing in App Store Connect (TestFlight tab),
  then install via TestFlight and re-verify the demo flow.

### 3.4 Create the app in App Store Connect

App Store Connect → **Apps → +** :
- Platform: iOS
- Name: **PNGPay**
- Primary language: English (U.S.)
- Bundle ID: `net.curriculate.pngpay`
- SKU: `pngpay-ios-001`
- User access: Full.

### 3.5 App Store listing (paste-ready)

| Field | Value |
|-------|-------|
| Name | `PNGPay` |
| Subtitle (30) | `Team hours, from the field` |
| Promotional text | `Submit your team's hours and leave from the job site.` |
| Description | *(paste "Full Description" from `store-metadata.md`)* |
| Keywords (100) | `payroll,timesheet,hours,supervisor,team,leave,roster,attendance,PNG,kina` |
| Support URL | `https://www.curriculate.net/contact` |
| Marketing URL | `https://www.curriculate.net/teebee` |
| Privacy Policy URL | `https://www.curriculate.net/privacy` |
| Primary category | Business |
| Secondary category | Productivity |
| Price | Free |

### 3.6 App Privacy questionnaire — exact answers

- Do you or your partners collect data from this app? **Yes**
- **Data used to track you: None.**
- **Data linked to the user** (each: linked = Yes, tracking = No, purpose = App Functionality):

| Category → Type | Purpose |
|-----------------|---------|
| Contact Info → **Name** | App Functionality |
| Contact Info → **Email Address** | App Functionality |
| Other Data → **Other Data** (hours & leave entries) | App Functionality |

- No Financial Info, Location, Health, Contacts, User Content, Identifiers,
  Usage Data, or Diagnostics collected.

### 3.7 Age rating

Answer **None / No** to every content question → **4+**.

### 3.8 Screenshots

Upload the required set (see §4). Minimum: 6.7" iPhone. Add 6.5" if you have it.
Only enable iPad if you upload 12.9" iPad shots.

### 3.9 App Review Information

- Sign-in required: **Yes** → provide demo account:
  - User name: `reviewer@teebeeaccountants.com.pg`
  - Password: `246810`  *(the fixed review PIN — note in the box below that this
    is the one-time PIN, entered on the PIN screen, no email needed)*
- Notes: paste the **App Review Notes** block from `store-metadata.md`, plus:
  > Sign-in is email + one-time PIN. For review, the account above uses a FIXED
  > PIN (`246810`) — no mailbox required. Enter the email, tap send code, then
  > enter `246810`. Accounts are administrator-provisioned (no in-app
  > registration), so account deletion is handled by the administrator on
  > request at info@teebeeaccountants.com.pg.
- Contact: your name, phone, `info@teebeeaccountants.com.pg`.

### 3.10 Submit

Attach the processed TestFlight build → **Add for Review** → **Submit**.
(Sign in with Apple does not apply — first-party email-PIN only; this is stated
in the review notes to preempt a 4.8 flag.)

---

## 4. Screenshots (needed for both stores)

Capture signed in as the demo supervisor, in this order:
1. **My team** — team list for the current period
2. **Enter hours** — per-person hours, a day expanded
3. **Record leave** — leave-type picker with a note
4. **Ready to submit** — whole team filled, submit visible
5. **Confirmation** — "submitted for approval"

Required sizes:
- **iOS:** 6.7" iPhone (1290×2796) required; 6.5" (1242×2688) optional; 12.9"
  iPad only if iPad is enabled.
- **Android:** ≥ 2 phone shots (min 1080px long edge); 7"/10" tablet only if
  targeting tablets. Feature graphic 1024×500 (already in `resources/`).

Best source is the iOS Simulator / Android emulator at those device sizes.
(Approximate framing can be captured from the live app in a resized browser.)

---

## 5. After submission

- **Android:** review is usually hours–2 days. Watch for "Broken Functionality"
  (that's why §2.4 device test matters) and Data safety mismatches.
- **iOS:** review is usually 1–2 days. Most common flags for this app class:
  can't-sign-in (mitigated by fixed PIN), 4.8 SIWA (pre-empted), 1.5 support URL
  (provided).
- **Updates:** bump `versionCode`+`versionName` (Android) and Build+Version
  (iOS) before each upload. Because it's a live-URL wrapper, content changes on
  `curriculate.net/teebeepay` ship with **no** store resubmission — only native
  shell changes need a new build.
