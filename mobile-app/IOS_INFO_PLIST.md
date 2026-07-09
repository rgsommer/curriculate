# iOS Info.plist — Pulse Grading

The `ios/` project isn't scaffolded yet. Once you run `npx cap add ios`,
Capacitor generates `ios/App/App/Info.plist` with a minimal skeleton. Paste
these keys into it (Xcode → App target → Info tab, or edit the file directly).

Every key here is **required** to pass App Store review. Missing purpose strings
are the #1 cause of rejection for camera/mic apps.

---

## Scaffold the iOS project

```bash
cd mobile-app
npm run cap:add:ios
# then:
npx cap sync ios
npx cap open ios
```

That opens Xcode. Xcode's Signing & Capabilities tab is where you set the
team, bundle ID (already `net.curriculate.pulse`), and capabilities.

---

## Info.plist — required keys

Paste each `<key>…</key><…>…</…>` pair inside the top-level `<dict>` in
`ios/App/App/Info.plist`. Order doesn't matter to the OS, but grouping by
category makes the file readable.

### Purpose strings (mandatory)

```xml
<!-- Camera: photo grading -->
<key>NSCameraUsageDescription</key>
<string>Pulse uses the camera to photograph student work so it can be graded by AI. Access is requested only when you tap the camera in the app.</string>

<!-- Microphone: audio grading + video-with-audio uploads. Required in Info.plist
     even if you don't use it at runtime — Apple's static analysis rejects builds
     that link a framework declaring microphone use without a purpose string. -->
<key>NSMicrophoneUsageDescription</key>
<string>Pulse can record spoken performances (music, speeches, drama) so they can be graded by AI. Microphone access is requested only when you tap Record.</string>

<!-- Photo Library: photo picker as an alternative to the live camera -->
<key>NSPhotoLibraryUsageDescription</key>
<string>Pulse can pick an existing photo of student work from your library to grade, as an alternative to using the camera.</string>
```

### Export compliance

```xml
<!-- Declare no non-exempt encryption so you skip the CCATS section of App
     Store Connect on every submission. Pulse only uses HTTPS + iOS's own
     TLS, which is exempt under Apple's cryptography rules. -->
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

### Push notifications

```xml
<!-- @capacitor/push-notifications registers with APNs at runtime. This
     background mode is required for silent pushes and update delivery. -->
<key>UIBackgroundModes</key>
<array>
    <string>remote-notification</string>
</array>
```

### Interface / status bar

```xml
<!-- Splash background matches capacitor.config.ts backgroundColor -->
<key>UIStatusBarStyle</key>
<string>UIStatusBarStyleLightContent</string>

<key>UIViewControllerBasedStatusBarAppearance</key>
<false/>

<!-- Support both portrait and landscape on iPhone. Add UpsideDown for iPad
     if you want the full quartet. -->
<key>UISupportedInterfaceOrientations</key>
<array>
    <string>UIInterfaceOrientationPortrait</string>
    <string>UIInterfaceOrientationLandscapeLeft</string>
    <string>UIInterfaceOrientationLandscapeRight</string>
</array>
<key>UISupportedInterfaceOrientations~ipad</key>
<array>
    <string>UIInterfaceOrientationPortrait</string>
    <string>UIInterfaceOrientationPortraitUpsideDown</string>
    <string>UIInterfaceOrientationLandscapeLeft</string>
    <string>UIInterfaceOrientationLandscapeRight</string>
</array>
```

### File sharing / batch grading

```xml
<!-- Batch grading accepts PDF uploads. This lets iOS Files app hand PDFs to
     the app via Share Sheet. Not strictly required for the current
     "in-page file input" flow but sets you up for a future share extension. -->
<key>LSSupportsOpeningDocumentsInPlace</key>
<true/>
<key>UISupportsDocumentBrowser</key>
<false/>
<key>UIFileSharingEnabled</key>
<false/>
```

### App Transport Security

```xml
<!-- Default deny all cleartext HTTP. The WebView only talks to
     curriculate.net (HTTPS). Do NOT add exceptions unless you need them. -->
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <false/>
</dict>
```

---

## PrivacyInfo.xcprivacy (mandatory for App Store 2024+)

Apple requires apps to declare their reason for using certain "required-reason
APIs" (e.g., UserDefaults, file timestamps). Capacitor 6 ships a plugin-level
privacy manifest for its own APIs, but the app itself also needs one.

Create `ios/App/App/PrivacyInfo.xcprivacy` with this content:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSPrivacyTracking</key>
    <false/>
    <key>NSPrivacyTrackingDomains</key>
    <array/>
    <key>NSPrivacyCollectedDataTypes</key>
    <array>
        <!-- Email address — optional (teacher opt-in) -->
        <dict>
            <key>NSPrivacyCollectedDataType</key>
            <string>NSPrivacyCollectedDataTypeEmailAddress</string>
            <key>NSPrivacyCollectedDataTypeLinked</key>
            <true/>
            <key>NSPrivacyCollectedDataTypeTracking</key>
            <false/>
            <key>NSPrivacyCollectedDataTypePurposes</key>
            <array>
                <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
            </array>
        </dict>
        <!-- Photos or Videos -->
        <dict>
            <key>NSPrivacyCollectedDataType</key>
            <string>NSPrivacyCollectedDataTypePhotosorVideos</string>
            <key>NSPrivacyCollectedDataTypeLinked</key>
            <false/>
            <key>NSPrivacyCollectedDataTypeTracking</key>
            <false/>
            <key>NSPrivacyCollectedDataTypePurposes</key>
            <array>
                <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
            </array>
        </dict>
        <!-- Audio Data -->
        <dict>
            <key>NSPrivacyCollectedDataType</key>
            <string>NSPrivacyCollectedDataTypeAudioData</string>
            <key>NSPrivacyCollectedDataTypeLinked</key>
            <false/>
            <key>NSPrivacyCollectedDataTypeTracking</key>
            <false/>
            <key>NSPrivacyCollectedDataTypePurposes</key>
            <array>
                <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
            </array>
        </dict>
        <!-- Other User Content — pasted answers, rubric text -->
        <dict>
            <key>NSPrivacyCollectedDataType</key>
            <string>NSPrivacyCollectedDataTypeOtherUserContent</string>
            <key>NSPrivacyCollectedDataTypeLinked</key>
            <false/>
            <key>NSPrivacyCollectedDataTypeTracking</key>
            <false/>
            <key>NSPrivacyCollectedDataTypePurposes</key>
            <array>
                <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
            </array>
        </dict>
        <!-- Product Interaction — first-party grading counts -->
        <dict>
            <key>NSPrivacyCollectedDataType</key>
            <string>NSPrivacyCollectedDataTypeProductInteraction</string>
            <key>NSPrivacyCollectedDataTypeLinked</key>
            <false/>
            <key>NSPrivacyCollectedDataTypeTracking</key>
            <false/>
            <key>NSPrivacyCollectedDataTypePurposes</key>
            <array>
                <string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
            </array>
        </dict>
        <!-- Coarse Location — derived server-side from IP -->
        <dict>
            <key>NSPrivacyCollectedDataType</key>
            <string>NSPrivacyCollectedDataTypeCoarseLocation</string>
            <key>NSPrivacyCollectedDataTypeLinked</key>
            <false/>
            <key>NSPrivacyCollectedDataTypeTracking</key>
            <false/>
            <key>NSPrivacyCollectedDataTypePurposes</key>
            <array>
                <string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
            </array>
        </dict>
    </array>
    <!-- Required reason APIs. Capacitor's WebView uses UserDefaults for
         plugin state (session storage), and NSFileManager for temp file
         access. -->
    <key>NSPrivacyAccessedAPITypes</key>
    <array>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <!-- Reason CA92.1: access info from same app, per docs -->
                <string>CA92.1</string>
            </array>
        </dict>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <!-- Reason C617.1: inside app container, per docs -->
                <string>C617.1</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
```

Add it to the Xcode project (drag it into the App target). It ships inside the
`.app` bundle and Apple's automated tooling reads it during upload.

---

## Xcode capabilities to enable (Signing & Capabilities tab)

- **Push Notifications** — required for @capacitor/push-notifications to work
  in production. Turning this on generates the APNs entitlements file.
- **Background Modes → Remote notifications** — mirrors the UIBackgroundModes
  key above.
- **Associated Domains** — NOT needed at launch. Only relevant if you later
  add universal-link handling for `curriculate.net/results/…` deep links.
- **Sign in with Apple** — NOT needed at launch (no login). Add when you turn
  on freemium and any auth flow appears.
- **In-App Purchase** — NOT needed at launch. Add when you turn on freemium.

---

## First-run sanity check

After `npx cap open ios`, from Xcode:

1. Select the App target → Signing & Capabilities → set your Team.
2. Product → Clean Build Folder.
3. Product → Archive.
4. Wait for archive; when Organizer opens, click "Validate App".
5. Xcode runs Apple's static analysis. If any purpose string is missing, or
   the encryption declaration is missing, it fails here — long before you
   waste a submission slot. Fix any red bar it flags.
6. If validation passes, click "Distribute App → App Store Connect" to
   upload the build for TestFlight/App Review.
