# PNGPay — Mobile App Setup

## Architecture

A **live-URL Capacitor wrapper**. The app loads the hosted TeeBee payroll app
inside a native WebView and adds native capabilities on top:

- **Haptics** — subtle feedback on submit
- **Deep links** — payroll links open in the app
- **Locked navigation** — stays in `/teebeepay`; other links open the system browser

> **Push notifications are NOT in v1.** They were cut to keep the first store
> review minimal (no Firebase/APNs, no notification permission). To add them
> later: reinstall `@capacitor/push-notifications`, restore the push block in
> `src/native-bridge.js`, add `google-services.json` (Android) + an APNs key
> and iOS push entitlement, then bump the version and resubmit.

The URL it loads is:
```
https://www.curriculate.net/teebeepay/app?app=1&view=team
```
- `app=1` hides the website header/footer and applies native safe-area layout
- `view=team` deep-links the supervisor straight to their **My team** hours screen after sign-in

There is **no camera** and **no location** — fewer permissions, faster review.
Sign-in is first-party **email + one-time PIN**, so Sign in with Apple (4.8)
does not apply.

> PNGPay is the established name for this payroll system in Papua New Guinea, so
> the app carries it for user recognition. It runs on the same TeeBee backend.

## Prerequisites
- Node.js 18+
- Xcode 15+ (iOS) / Android Studio (Android)
- Apple Developer account ($99/yr) · Google Play Developer account ($25 one-time)

## Quick Start
```bash
cd mobile-app-pngpay

npm install

# Generate app icons + splash from resources/icon.png & resources/splash.png
npm run icons

# Build the fallback web page (www/)
npm run build:web

# Add native platforms
npm run cap:add:ios
npm run cap:add:android

# Sync web assets + plugins into the native projects
npm run cap:sync

# Open the native IDEs
npm run cap:open:ios
npm run cap:open:android
```

> Icons/splash are pre-generated in `resources/` (red `#b9302a` icon with a gold
> `#f4b400` Kina "K" mark; navy `#0f2c52` splash). Re-run `npm run icons` after
> replacing them to regenerate every platform size.

## Project Structure
```
mobile-app-pngpay/
├── capacitor.config.ts    # appId net.curriculate.pngpay, live URL, plugins
├── package.json           # deps + cap scripts (no camera)
├── index.html             # fallback splash while the live app loads
├── pngpay-icon.png        # badge used by index.html
├── www/                   # built web assets (git-ignored)
├── src/native-bridge.js   # push, haptics, deep links, nav guard (window.PngpayNative)
├── resources/             # icon.png (1024²) + splash.png (2732²) sources
├── ios/  android/         # generated native projects (git-ignored)
├── store-metadata.md      # listing copy, privacy, review notes
└── SETUP.md               # this file
```

## Native permissions
v1 uses **no sensitive permissions** — no camera, location, or push. The
WebView needs only internet access (added by Capacitor automatically).

Do **not** add camera, location, or notification entries — the app does not use
them in v1, and an unused permission is a rejection risk.

## App Review notes
Business apps that require login **must** ship a demo account or reviewers
cannot get past sign-in. Fill in the demo supervisor account in
`store-metadata.md` → *App Review Notes*, and remember the email-PIN caveat:
either give reviewers a mailbox they can read, or set a fixed review PIN for
that one account. See `store-metadata.md` for the full paste-ready notes.

## Deployment Checklist

### iOS (App Store)
- [ ] Xcode project builds + runs on simulator
- [ ] App icon (1024²) + splash configured (`npm run icons`)
- [ ] Support URL set (curriculate.net/contact) + privacy URL (curriculate.net/privacy)
- [ ] App Privacy form filled (email, name, employment info; no tracking)
- [ ] Screenshots: 6.7" + 6.5" iPhone (+ iPad if enabled)
- [ ] **Demo supervisor account + PIN note in Review Notes**
- [ ] TestFlight build uploaded and tested end-to-end

### Android (Play Store)
- [ ] Android Studio project builds + runs on emulator
- [ ] Adaptive icon + splash configured
- [ ] Data safety form filled (matches store-metadata table)
- [ ] Support + privacy URLs set
- [ ] Screenshots: phone (≥2) + 7"/10" tablet; feature graphic 1024×500
- [ ] **Demo supervisor account + PIN note in testing instructions**
- [ ] Internal testing track build uploaded, then production release
