# Campfire — native app (iOS + Android)

A [Capacitor](https://capacitorjs.com) shell that wraps the live Campfire web app
(`https://www.curriculate.net/campfirelive`) as a real App Store / Play Store app.
The webview always loads the hosted site, so the app stays current with every Vercel
deploy — no rebuild needed for content changes.

The web app already does the heavy lifting (it's a PWA with a manifest, service
worker, and icons). This project is just the native wrapper + the store plumbing.

---

## 0. Prerequisites (one-time)

- **macOS + Xcode** (latest) — for iOS. You have a Mac. Install Xcode from the App Store, then `xcode-select --install`.
- **Android Studio** — for Android. Install the SDK + an emulator.
- **CocoaPods**: `sudo gem install cocoapods` (iOS native deps).
- **Apple Developer Program** — $99/yr, https://developer.apple.com/programs/
- **Google Play Console** — $25 once, https://play.google.com/console/

## 1. Install + add the platforms

```bash
cd ~/dev/curriculate/campfire-app
npm install
npx cap add ios
npx cap add android
npx cap sync
```

This generates `ios/` and `android/` native projects from `capacitor.config.ts`.

## 2. App icon + splash

Drop a 1024×1024 PNG icon and a splash image into `resources/` and generate all sizes:

```bash
# reuse the existing Campfire icon from the web app:
mkdir -p resources
cp ../frontend/public/campfire-icon-512.png resources/icon.png   # upscale to 1024 ideally
npx @capacitor/assets generate --iconBackgroundColor '#fff7ed' --splashBackgroundColor '#fff7ed'
```

## 3. Deep link for Google sign-in (campfire://)

Google blocks OAuth inside the webview, so Google sign-in opens the **system browser**
and returns via the `campfire://auth-callback` deep link (handled by `NativeBridge`
in the web app). Wire the scheme into each platform + Supabase:

- **iOS** — Xcode → target → *Info* → *URL Types* → add URL Scheme `campfire`.
- **Android** — `android/app/src/main/AndroidManifest.xml`, add an intent-filter to
  the main activity:
  ```xml
  <intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="campfire" android:host="auth-callback" />
  </intent-filter>
  ```
- **Supabase** — Auth → URL Configuration → **add `campfire://auth-callback`** to the
  allowed Redirect URLs.

(Email/password and guest login work entirely inside the webview — no setup needed.)

## 4. Run on a device/simulator

```bash
npx cap open ios       # opens Xcode → pick a simulator/device → Run
npx cap open android   # opens Android Studio → Run
```

## 5. Push notifications

The send pipeline is **already built** — the daily digest cron pushes to devices
via Firebase Cloud Messaging (FCM v1, which covers both Android and iOS). The web
app requests permission and registers the device token (`/api/campfire/push/register`
→ `campfire_push_tokens`), and the cron mints an FCM token and sends. It's inert
until you provide the credential, so the app builds/runs fine without it.

To turn it on:

1. **Create a Firebase project** and add an Android app (`google-services.json` →
   `android/app/`) and an iOS app (`GoogleService-Info.plist` → Xcode).
2. **Apple**: upload an APNs **key (.p8)** to Firebase → Project settings → Cloud
   Messaging, and enable the **Push Notifications** + **Background Modes
   (Remote notifications)** capabilities in Xcode.
3. **Service account**: Firebase → Project settings → Service accounts → *Generate
   new private key*. Add the whole JSON as a Vercel env var:
   ```
   FCM_SERVICE_ACCOUNT={"type":"service_account","project_id":"…","private_key":"…", …}
   ```
4. Redeploy. The next daily digest run will also push (`pushed` count in the cron's
   JSON response confirms it).

Tapping a push opens Campfire (the payload carries a `link`). To deep-link to a
specific engagement later, extend the payload + handle it in `NativeBridge`.

## 6. Build, sign & submit

**iOS**
1. Xcode → *Signing & Capabilities* → select your Team, set bundle id `net.curriculate.campfire`.
2. *Product → Archive* → *Distribute App → App Store Connect*.
3. In [App Store Connect](https://appstoreconnect.apple.com): create the app, fill
   metadata, attach the build, submit for review.

**Android**
1. Android Studio → *Build → Generate Signed Bundle/APK → Android App Bundle (.aab)*,
   create/select a keystore.
2. In Play Console: create the app, upload the `.aab`, fill the listing, submit.

## 7. App Store review checklist (avoid "thin wrapper" rejection)

- ✅ Single, clear purpose (Campfire) with native shell (splash, icons, push).
- ✅ **Account deletion** in-app (Apple requires it for apps with accounts) — add a
  "Delete account" action in Campfire settings if not present.
- ✅ **Privacy policy** URL + App Privacy questionnaire (data: email, name, usage).
- ✅ Works for a reviewer without a special account — the **guest "Join as guest"**
  path is perfect; mention it in review notes.
- ✅ No broken external links; all in-app navigation stays in the shell.

## Updating the app

- **Content/logic** changes ship automatically (the webview loads the live site).
- **Native** changes (config, plugins, icons, deep links) need a new build + store
  submission. Bump the version in `capacitor.config.ts`/native project and re-archive.

## Config reference

- App id: `net.curriculate.campfire`
- App name: `Campfire`
- Loads: `https://www.curriculate.net/campfirelive` (`capacitor.config.ts` → `server.url`)
- Deep link: `campfire://auth-callback`
