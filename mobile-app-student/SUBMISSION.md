# Curriculate Student — App Store & Play Store Submission Guide

Native shell wrapping the student play app at `https://play.curriculate.net`.
Students join a live session by room code (no login) and play task stations.
Targets **iPhone + iPad + Android** from one Capacitor codebase.

- **App name:** Curriculate Student
- **Bundle ID / Package:** `net.curriculate.student`
- **Apple Team:** Applicable Software Inc — `8XSHU49K2X`
- **Splash / theme base:** `#f5f7ff` (light, to distinguish from the teacher app)

## State of the build (done in repo)

- ✅ Deps installed; iOS + Android platforms added; pods installed
- ✅ Light emblem icon + splash (distinct from teacher app's dark icon)
- ✅ iOS Info.plist: camera, microphone, motion, photo usage strings + encryption-exempt key
- ✅ Android manifest: CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS + optional camera/mic features
- ✅ Bundle id + display name verified on both platforms

## ⚠️ Must test on-device before submitting

The web app uses `getUserMedia` (camera/mic) and `DeviceMotion` directly.

- **iOS:** works in WKWebView (iOS 14.3+) with the Info.plist usage strings — verify the QR scanner opens the camera.
- **Android:** manifest permissions are set, but the WebView also needs the **runtime** permission granted. Test the QR scanner on a real device/emulator. If the camera prompt never appears, add a runtime permission request for CAMERA/RECORD_AUDIO in `MainActivity` (the QR scanner has a manual-code fallback, so the app still functions if declined).
- **Motion Mission** needs a user tap to trigger the iOS motion permission prompt — verify it counts movement.

## Rebuild from scratch (if needed)

```bash
cd mobile-app-student
npm install && npm run build:web
npx cap add ios && npx cap add android
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8   # if pod install errors on new Ruby
npx capacitor-assets generate --iconBackgroundColor '#ffffff' --splashBackgroundColor '#f5f7ff'
npx cap sync
# then re-apply Info.plist (camera/mic/motion/encryption) + AndroidManifest permissions
```

---

## A. Apple App Store (iPhone + iPad)

1. **App ID** — developer.apple.com → Identifiers → register Explicit
   `net.curriculate.student` (no special capabilities required unless you add push).
2. **App record** — App Store Connect → New App → **iOS** (covers iPhone + iPad),
   Bundle ID `net.curriculate.student`, SKU `curriculate-student`.
3. `npm run cap:open:ios` → set Team → **Applicable Software Inc**. Do NOT rename the `App` target/scheme.
4. Product → Archive → Distribute → App Store Connect → Upload.
5. Fill listing from `store-metadata.md`; provide **both iPhone and iPad screenshots**
   (iPad screenshots are required if the app supports iPad — it does).
6. Privacy: camera, microphone, motion — all "app functionality", no tracking. Submit.

## B. Google Play Store (phones + Android tablets)

1. Play Console → Create app → **Curriculate Student**, Education.
2. `npm run cap:open:android` → sign a release AAB (reuse/create an upload keystore).
3. Upload to Production (or Internal testing first — recommended for the camera test).
4. Data safety form: camera, microphone, motion; no third-party sharing.
5. Mark as suitable for tablets. Send for review.

## What still needs a human / accounts

- Code signing (Apple Team; Android upload keystore)
- On-device camera/mic/motion testing (especially Android)
- Screenshots (iPhone + iPad + Android tablet)
- Store listing submission + privacy questionnaires
