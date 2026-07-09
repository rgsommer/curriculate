# TeeBee Field — Mobile App Setup

## Architecture

A **live-URL Capacitor wrapper**. The app loads the hosted TeeBee app inside a
native WebView and adds native capabilities on top:

- **Push notifications** — hours-due reminders / approval notices
- **Haptics** — subtle feedback on submit
- **Deep links** — TeeBee links open in the app
- **Locked navigation** — stays in `/teebeepay`; other links open the system browser

The URL it loads is:
```
https://www.curriculate.net/teebeepay/app?app=1&view=team
```
- `app=1` hides the website header/footer and applies native safe-area layout
- `view=team` deep-links the supervisor straight to their **My team** hours screen after sign-in

There is **no camera** and **no location** — fewer permissions, faster review.
Sign-in is first-party **email + one-time PIN**, so Sign in with Apple (4.8)
does not apply.

## Prerequisites
- Node.js 18+
- Xcode 15+ (iOS) / Android Studio (Android)
- Apple Developer account ($99/yr) · Google Play Developer account ($25 one-time)

## Quick Start
```bash
cd mobile-app-field

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

> Icons/splash are pre-generated in `resources/` (TeeBee red `#b9302a` icon
> with gold `#f4b400` monogram; navy `#0f2c52` splash). Re-run `npm run icons`
> after replacing them to regenerate every platform size.

## Project Structure
```
mobile-app-field/
├── capacitor.config.ts    # appId net.curriculate.teebeefield, live URL, plugins
├── package.json           # deps + cap scripts (no camera)
├── index.html             # fallback splash while the live app loads
├── teebee-icon.png        # badge used by index.html
├── www/                   # built web assets (git-ignored)
├── src/native-bridge.js   # push, haptics, deep links, nav guard (window.TeebeeNative)
├── resources/             # icon.png (1024²) + splash.png (2732²) sources
├── ios/  android/         # generated native projects (git-ignored)
├── store-metadata.md      # listing copy, privacy, review notes
└── SETUP.md               # this file
```

## Native permissions
| Store | Permission | Why |
|-------|-----------|-----|
| iOS Info.plist | Push (UIBackgroundModes → remote-notification) | Hours-due reminders |
| Android Manifest | `POST_NOTIFICATIONS`, Firebase (FCM) | Hours-due reminders |

Do **not** add camera or location entries — the app does not use them, and an
unused permission is a rejection risk.

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
- [ ] Push entitlement enabled; APNs key uploaded
- [ ] Support URL set (curriculate.net/contact) + privacy URL (curriculate.net/privacy)
- [ ] App Privacy form filled (email, name, employment info; no tracking)
- [ ] Screenshots: 6.7" + 6.5" iPhone (+ iPad if enabled)
- [ ] **Demo supervisor account + PIN note in Review Notes**
- [ ] TestFlight build uploaded and tested end-to-end

### Android (Play Store)
- [ ] Android Studio project builds + runs on emulator
- [ ] Adaptive icon + splash configured
- [ ] Firebase (FCM) configured for push
- [ ] Data safety form filled (matches store-metadata table)
- [ ] Support + privacy URLs set
- [ ] Screenshots: phone (≥2) + 7"/10" tablet; feature graphic 1024×500
- [ ] **Demo supervisor account + PIN note in testing instructions**
- [ ] Internal testing track build uploaded, then production release
