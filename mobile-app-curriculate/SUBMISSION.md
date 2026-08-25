# Qrewzi Teacher — App Store & Play Store Submission Guide

The native shell wraps the live GameMaster console at `set.qrewzi.com?app=1`.
One codebase, instant content updates, no store resubmission for web changes.

- **App name:** Qrewzi Teacher
- **Bundle ID / Package:** `net.curriculate.sessions`
- **Apple Team:** Applicable Software Inc — `8XSHU49K2X`
- **Splash / brand base:** `#0b1024`

## State of the build (done in repo)

- ✅ `npm install` — deps installed (incl. `@capacitor/camera`)
- ✅ iOS platform added + `pod install` complete (`ios/App/App.xcworkspace`)
- ✅ Android platform added + Gradle synced (`android/`)
- ✅ App icons + splash generated for iOS, Android, PWA (source art in `assets/`)
- ✅ `Info.plist` camera/photo usage strings added (App Store requires them)
- ✅ Bundle ID + display name verified matching on both platforms

## Rebuild from scratch (if needed)

```bash
cd mobile-app-curriculate
npm install
npm run build:web
npx cap add ios        # if ios/ missing
npx cap add android    # if android/ missing
# pod install here needs a UTF-8 locale on new Ruby — export first if it errors:
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
npx capacitor-assets generate --iconBackgroundColor '#0f172a' --splashBackgroundColor '#0b1024'
npx cap sync
```

---

## A. Apple App Store

1. **App ID** — developer.apple.com → Certificates, Identifiers & Profiles →
   Identifiers → register **Explicit** `net.curriculate.sessions`, enable
   **Push Notifications**.
2. **App record** — App Store Connect → New App → iOS only, Bundle ID
   `net.curriculate.sessions`, SKU `curriculate-sessions`.
3. **Open + sign:**
   ```bash
   npm run cap:open:ios
   ```
   In Xcode: select the **App** target → Signing & Capabilities → set **Team**
   to Applicable Software Inc. Add the **Push Notifications** capability.
4. **Archive:** Product → Destination → *Any iOS Device* → Product → **Archive**.
5. **Upload:** Organizer → Distribute App → App Store Connect → Upload.
6. **List:** in App Store Connect fill description / keywords / screenshots
   (all drafted in `store-metadata.md`), privacy answers (camera + push, no
   tracking), then **Add for Review** → **Submit**.

## B. Google Play Store

1. Play Console → Create app → name **Curriculate**, category Education.
2. Build the release AAB:
   ```bash
   npm run cap:open:android    # or: cd android && ./gradlew bundleRelease
   ```
   Sign with your upload keystore (reuse the Pulse keystore or create one;
   keep it safe — losing it blocks future updates).
3. Upload the AAB to a **Production** (or Internal testing) release.
4. Complete the Play listing: short/full description, screenshots, feature
   graphic (see `store-metadata.md`), data-safety form (camera + push, no
   third-party sharing), content rating, target audience.
5. **Send for review.**

## Store assets checklist

| Asset | Source |
|---|---|
| App icon (1024²) | `assets/icon.png` → generated into both platforms |
| Splash | `assets/splash.png` / `splash-dark.png` |
| Screenshots (5–6) | Capture from a running device — shot list in `store-metadata.md` |
| Feature graphic (Play, 1024×500) | Create from `Curriculate_logo.png` |
| Privacy policy | https://qrewzi.com/privacy |
| Support URL | https://qrewzi.com/contact |

## What still needs a human / accounts

- Code signing (Apple Team + Xcode; Android upload keystore)
- Screenshots from a real device/simulator
- Store listing submission + privacy questionnaires
- App review responses
