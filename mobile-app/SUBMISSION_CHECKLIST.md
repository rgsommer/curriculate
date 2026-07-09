# Pulse Grading — Submission Pre-Flight Checklist

The two most valuable exercises before you upload: (1) match every Apple/Google
policy risk against what Pulse actually does, and (2) know the answer to every
reviewer question before they ask. Everything here is app-specific, not generic.

Ordered by **historical rejection rate** — the ones near the top are what catches
first-timers on Pulse's exact profile (education tool with camera + AI backend +
Capacitor WebView + no login).

---

## 🔴 Highest-rejection items — verify these first

### Apple 5.1.1 — Data collection & storage (purpose strings)
The single most common rejection for camera/mic apps. Every sensitive-permission
prompt needs a purpose string that a normal human would understand.

Required Info.plist keys (paste these AFTER you run `npx cap add ios` — the
`cap add ios` step generates a starter Info.plist and you paste over/into it).
See `IOS_INFO_PLIST.md` for the full template.

- `NSCameraUsageDescription` — must exist and be specific about what you're
  doing with the photo. Not "for camera access". Something like:
  *"Pulse uses the camera to photograph student work so it can be graded by AI."*
- `NSMicrophoneUsageDescription` — required because @capacitor/camera declares
  microphone in its plugin manifest even if you never use it; Apple's static
  analysis catches this and rejects builds without a purpose string even when
  you don't ask at runtime. Use:
  *"Pulse can record spoken performances (music, speeches, drama) so they can be
  graded by AI. Microphone access is only requested when you tap 'Record'."*
- `NSPhotoLibraryUsageDescription` — required for the photo picker path.
  *"Pulse can pick an existing photo of student work from your library to grade,
  as an alternative to using the camera."*
- `NSPhotoLibraryAddUsageDescription` — required if the app saves PDF reports
  back to the Photos app. Currently N/A; leave out unless that feature ships.

### Apple 5.1.1(v) — Account deletion
Only required *if* you offer account creation in the app. Pulse's launch build
has NO login, so 5.1.1(v) is N/A. Add a one-line note to the reviewer:
*"The app does not require or offer account creation. No accounts are created
by the app; therefore Guideline 5.1.1(v) does not apply."*

**If** you later add a teacher login for roster/progress features, you must add
an in-app "Delete account" flow reachable without contacting support.

### Apple 4.8 — Sign in with Apple
Only triggers if the app offers third-party (Google/Facebook/Microsoft) sign-in
without offering SIWA. Pulse's launch build has no login → N/A. Add the same
one-liner as above to the reviewer notes.

### Apple 3.1.1 — In-app purchases
The gotcha for future freemium activation. **Not applicable at launch** — the
app has no IAP and no paywall UI renders before 2026-11-30. But when you flip
`FREEMIUM.FORCE_ENABLED` or the date passes:
- Any "Upgrade to Plus" button inside iOS must open StoreKit IAP, not a Stripe
  checkout page.
- Wire in `@capacitor-community/in-app-purchases-2` or similar, register
  products in App Store Connect, and route Plus tier unlock through StoreKit.
- Submit a new build with IAP declared in App Privacy → "Purchases".
- **Do not** leave the `/pricing` link visible inside the iOS app after
  activation — that's the #1 3.1.1 reject reason for education apps.

### Apple 1.5 — Support URL
Required. Pulse's support URL is `https://curriculate.net/contact` — verify the
page exists AND explains how to reach a human. Campfire got rejected on this
exact point (URL 404'd) in commit `2730bc14`.

### Google Play — Target SDK 35+ requirement (2025-08-31+)
Applied. `android/variables.gradle` now targets 35. Verify the AAB in
`bundletool dump manifest` shows `targetSdkVersion="35"` after rebuild.

### Google Play — Data Safety form (accuracy)
Play doesn't reject the initial submission for a wrong Data Safety answer, but
they'll audit you post-launch and can pull the app. The answers in
`PLAY-STORE-LISTING.md` §3 are conservative and match what the code actually
does. Only change them if you add ad SDKs / third-party analytics.

### Google Play — Prominent Disclosure for sensitive permissions
When the app opens the camera or mic for the first time, the *first* screen the
user sees must explain what the app is going to do with it. Pulse is fine here
because the runtime prompts fire from a user-initiated action (tap Photo tab →
prompt appears), so the disclosure is contextual. If you ever move to background
capture, this becomes a policy issue.

---

## 🟡 Medium-risk items

### Apple 4.3 — Spam / duplicate app
Curriculate has multiple apps in the store (Student, Session host, Campfire,
Pulse). Apple sometimes flags these as spam if they look too similar. Mitigation:
- Different icons.
- Different bundle IDs (already the case — `net.curriculate.pulse` vs the
  others).
- Reviewer notes: *"Curriculate Pulse is one app in a family of separate,
  functionally distinct teacher tools. It is NOT a re-skin — it is the AI
  grading tool. The other apps (Student, Session host, Campfire) target
  different workflows."*

### Apple 4.0 — HIG conformance
The WebView renders a mobile-optimized website. Apple sometimes rejects
"webviews wrapping a website" under 4.2 (minimum functionality). Mitigation:
- The app IS more than a webview: it has native camera integration, push
  notifications, and haptics via `@capacitor/*` plugins.
- The reviewer notes should mention: *"Pulse uses native iOS camera, push
  notifications, and haptics through Capacitor. The web UI is a shared
  codebase between web and mobile so teachers get the same feature set on
  every device."*
- The safe-area padding and hiding of site header/footer via `.capacitor-native`
  CSS class (already implemented) makes the app feel native rather than a
  browser window.

### Apple 2.5.4 — Multitasking apps that use background modes
Only push notifications are declared in `UIBackgroundModes` (via
`@capacitor/push-notifications`). Fine.

### Apple 5.1.2 — Data collection consent
The app doesn't collect any personal data until the teacher opts in (types an
email, types a name). All background analytics are aggregated usage counts
(GradingUsage) — non-personal. Fine.

### Google Play — Camera + Photo permission dual declaration
Android 13+ splits `READ_EXTERNAL_STORAGE` into `READ_MEDIA_IMAGES` etc. The
photo picker (used when the teacher taps "Upload" instead of "Camera") uses the
system picker on Android 13+ which does NOT require any media permission.
Capacitor's file input handles this automatically. No manifest change needed.

### Google Play — Foreground services
Not used. No permission needed.

---

## 🟢 Lower-risk items to verify

- [ ] App icon rendered at every required size (see `screenshot-spec.md`).
- [ ] Splash screen matches launch icon look — no white-flash on cold start.
- [ ] `versionCode` is strictly greater than the last published build.
      Current: `2` / `1.0.1`. Bump this before every upload.
- [ ] The AAB verifies with `bundletool validate --bundle=…`.
- [ ] Deep links work — external `https://curriculate.net` links open in the
      external browser (mobile-app/src/native-bridge.js already handles this).
      Verify by tapping any external link from inside the grading page.
- [ ] The privacy policy page (`https://curriculate.net/privacy`) mentions
      OpenAI processing explicitly. Reviewers check this.
- [ ] The support page (`https://curriculate.net/contact`) resolves and offers
      a real email address, not a form-only contact.
- [ ] The video and audio grading modes both work with a small (≤ 5 MB) file
      on a real device before submission. The async-job pattern was recently
      added — smoke-test on a real cellular connection.

---

## Post-launch freemium (blocked until 2026-11-30)

When freemium activates you MUST:

1. **Ship StoreKit IAP for iOS** before flipping the flag. External payment
   links from inside iOS violate Apple 3.1.1.
2. **Ship Play Billing for Android** for the same reason (Google Play policy
   §3.1.1). Stripe checkout inside the Android app for digital feature unlock
   is not allowed.
3. **Update App Privacy** to add `Purchases → App Functionality → Linked=Yes`.
4. **Update Data Safety** to add `Financial info → In-app purchase history`.
5. **New App Store + Play submissions** — both stores require review of any
   build that introduces new IAP products.
6. **Do NOT** show the `/pricing` (Stripe) link inside the mobile apps after
   activation. Use `Capacitor.isNativePlatform()` and swap to a StoreKit /
   Play Billing flow.
7. Optional but recommended: add **Sign in with Apple** at that point since a
   paid tier arguably needs identity persistence. Apple 4.8 becomes relevant
   if you also offer other social sign-in options at that time.

Track this in a separate `POST_LAUNCH_TODO.md` when the time comes.

---

## Sanity script (run before each submission)

```bash
# Android AAB dry-run
cd android
./gradlew clean bundleRelease
bundletool dump manifest --bundle=app/build/outputs/bundle/release/app-release.aab \
  | grep -E "targetSdkVersion|versionCode|permission"

# Check every required Info.plist key is present (iOS)
cd ../ios/App/App
plutil -convert xml1 -o - Info.plist \
  | grep -E "NSCameraUsageDescription|NSMicrophoneUsageDescription|NSPhotoLibraryUsageDescription|ITSAppUsesNonExemptEncryption"
```

If any of those greps come up empty, don't submit yet — the reviewer will
reject on the missing item.
