# Google Play Store Submission — Step-by-Step

This guide walks you through everything from creating your developer account to having Curriculate Pulse live on the Play Store.

---

## Step 1: Google Play Developer Account

1. Go to https://play.google.com/console/signup
2. Sign in with a Google account (use one you want associated with the app permanently)
3. Pay the **$25 one-time registration fee**
4. Complete identity verification (takes 1–3 business days)
5. Accept the Developer Distribution Agreement

**Important:** Google now requires identity verification before you can publish. Have a government-issued ID ready.

---

## Step 2: Install Prerequisites on Your Machine

```bash
# You need:
# - Node.js 18+
# - Android Studio (includes SDK, emulator, and build tools)
# - Java 17 (bundled with Android Studio)

# Verify Node
node --version   # should be 18+

# Install Android Studio from:
# https://developer.android.com/studio

# After installing Android Studio:
# 1. Open it → SDK Manager → install Android 14 (API 34) SDK
# 2. Install "Android SDK Build-Tools" and "Android SDK Command-line Tools"
# 3. Accept all SDK licenses:
#    sdkmanager --licenses
```

Set these environment variables (add to `~/.zshrc` or `~/.bashrc`):
```bash
export ANDROID_HOME=$HOME/Library/Android/sdk   # macOS
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

---

## Step 3: Build the Android Project

```bash
cd mobile-app

# Install Node dependencies
npm install

# Copy icon assets into resources/
cp ../frontend/public/images/pulse/pulse-icon.png resources/icon.png
cp ../frontend/public/images/pulse/pulse-logo.png resources/splash.png

# Generate app icons and splash screens
npm run icons

# Build the fallback web page
npm run build:web

# Add the Android platform (generates android/ directory)
npm run cap:add:android

# Sync web assets and plugin configs
npm run cap:sync

# Open in Android Studio
npm run cap:open:android
```

---

## Step 4: Configure the Android Project

Once Android Studio opens the project:

### 4a. Verify App ID and Version
The `capacitor.config.ts` already sets `appId: "net.curriculate.pulse"`. Verify in Android Studio:
- Open `android/app/build.gradle`
- Confirm `applicationId "net.curriculate.pulse"`
- Set `versionCode 1` and `versionName "1.0.0"`

### 4b. Set Minimum SDK
In `android/app/build.gradle`, ensure:
```gradle
minSdkVersion 24        // Android 7.0+, covers 97% of devices
targetSdkVersion 34     // Android 14 (required by Google)
```

### 4c. App Permissions
Capacitor plugins auto-add permissions, but verify in `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
```

### 4d. Signing Key (CRITICAL — save this forever)
Generate a release signing key:
```bash
keytool -genkey -v \
  -keystore curriculate-pulse-release.keystore \
  -alias pulse \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```
- **Store the keystore file and password somewhere safe.** You cannot update the app without it.
- You'll be prompted for a password, name, and organization. Use:
  - CN: Richard Sommer
  - OU: Curriculate
  - O: Curriculate
  - L/ST/C: your location

Then configure signing in `android/app/build.gradle`:
```gradle
android {
    signingConfigs {
        release {
            storeFile file("../../curriculate-pulse-release.keystore")
            storePassword "YOUR_PASSWORD"
            keyAlias "pulse"
            keyPassword "YOUR_PASSWORD"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

---

## Step 5: Build the Release AAB

Google Play requires an Android App Bundle (.aab), not an APK.

```bash
# From the mobile-app directory:
cd android

# Build the release bundle
./gradlew bundleRelease

# The AAB will be at:
# android/app/build/outputs/bundle/release/app-release.aab
```

Or build from Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle → Release**

---

## Step 6: Create the App in Play Console

1. Go to https://play.google.com/console
2. Click **"Create app"**
3. Fill in:
   - **App name:** Curriculate Pulse
   - **Default language:** English (United States)
   - **App or game:** App
   - **Free or paid:** Free
4. Accept declarations and click **Create app**

---

## Step 7: Store Listing

Go to **Main store listing** and fill in:

### Text
Copy from `store-metadata.md` (already prepared):
- **Short description (80 chars):** Grade papers with AI. Photo → rubric → feedback in seconds. Free for teachers.
- **Full description:** Copy the full description from store-metadata.md

### Graphics
Upload these from the `resources/` folder:
- **App icon:** `resources/play-store-icon.png` (512×512)
- **Feature graphic:** `resources/feature-graphic.png` (1024×500)
- **Screenshots:** See Step 8 below

### Categorization
- **App category:** Education
- **Tags:** Education, Productivity

---

## Step 8: Screenshots

Google requires at least 2 screenshots per device type. Recommended: **4–8 phone screenshots**.

### How to capture them:
1. Run the app on an Android emulator in Android Studio (Pixel 7 recommended)
2. Navigate to each screen and use the camera icon in the emulator toolbar
3. Or use: `adb exec-out screencap -p > screenshot.png`

### Recommended screenshots:
1. **Grading page** — camera view with a student paper, rubric visible
2. **AI feedback result** — showing score, grade, detailed feedback
3. **Batch grading** — class grid with scores and student names
4. **Voice selector** — showing the 13 feedback voice options
5. **Session / Email Reports** — showing the session panel with results
6. **Progress portal** — student dashboard with grade tracking

### Screenshot specs:
- Minimum: 320px on shortest side, 3840px max on longest
- Recommended: 1080×1920 (phone), 1200×1920 (7" tablet)
- PNG or JPEG, max 8MB each
- At least 2, up to 8 per device type

---

## Step 9: Content Rating

Go to **Policy → App content → Content rating**:
1. Start the questionnaire
2. Select **"Utility, Productivity, Communication, or other"**
3. Answer all questions "No" (no violence, gambling, etc.)
4. You'll get a rating of **"Everyone"** (equivalent to PEGI 3 / ESRB E)

---

## Step 10: Privacy Policy

Go to **Policy → App content → Privacy policy**:
- Enter: `https://www.curriculate.net/privacy`
- (Already updated with Pulse-specific data handling)

---

## Step 11: Data Safety Section

Go to **Policy → App content → Data safety**:

Fill in the form:

**Does your app collect or share any user data?** → Yes

| Data type | Collected | Shared | Purpose | Optional |
|-----------|-----------|--------|---------|----------|
| Name | Yes | No | App functionality | No (for roster) |
| Email address | Yes | No | App functionality, Account management | No |
| Photos | Yes | No | App functionality (grading) | No |
| App interactions | Yes | No | Analytics | No |

**Data handling:**
- Is data encrypted in transit? → **Yes** (HTTPS)
- Can users request data deletion? → **Yes** (email admin@curriculate.net)
- Does the app follow the Families Policy? → **No** (tool for teachers, not children)

---

## Step 12: Target Audience

Go to **Policy → App content → Target audience**:
- Target age group: **18 and over** (this is a teacher tool)
- This avoids the stricter "Designed for Families" requirements

---

## Step 13: Ads Declaration

- **Does your app contain ads?** → No

---

## Step 14: Testing Track (Recommended First)

Before going to production, upload to **Internal testing** first:

1. Go to **Testing → Internal testing**
2. Click **Create new release**
3. Upload your `app-release.aab` file
4. Add release notes: "Initial release of Curriculate Pulse — AI grading for teachers"
5. Click **Review release** → **Start rollout**
6. Add your Google account as a tester
7. You'll get a test link to install the app on your phone

Test everything:
- [ ] App opens and loads curriculate.net
- [ ] Camera works for photo grading
- [ ] Results display correctly
- [ ] Back button works properly
- [ ] App icon and splash screen look right

---

## Step 15: Production Release

Once testing looks good:

1. Go to **Production** → **Create new release**
2. Upload the same (or updated) AAB
3. Release notes:
   ```
   Curriculate Pulse 1.0 — AI-powered grading for teachers.
   • Snap a photo of student work and get AI feedback in seconds
   • 13 feedback voices from encouraging coach to rigorous academic
   • Batch grade a whole class from a single PDF scan
   • Free for all teachers
   ```
4. Click **Review release** → **Start rollout to Production**

---

## Step 16: Review Timeline

- **Internal testing:** Available immediately (no review)
- **Production review:** Typically 1–3 days for new apps, can take up to 7 days
- Google may ask follow-up questions about educational content or data handling

---

## Quick Reference: File Locations

| Asset | Path |
|-------|------|
| Capacitor config | `mobile-app/capacitor.config.ts` |
| App icon (512×512) | `mobile-app/resources/play-store-icon.png` |
| Feature graphic (1024×500) | `mobile-app/resources/feature-graphic.png` |
| Store listing copy | `mobile-app/store-metadata.md` |
| Privacy policy | `curriculate.net/privacy` (live page) |
| Native bridge | `mobile-app/src/native-bridge.js` |
| Signing key | `mobile-app/curriculate-pulse-release.keystore` (you generate this) |
| Release AAB | `mobile-app/android/app/build/outputs/bundle/release/app-release.aab` |

---

## Common Rejection Reasons & How to Avoid Them

1. **"Webview app with limited functionality"** — Google rejects thin wrappers. Your app has native camera, push notifications, and haptics — mention these in the app description and in any review responses.

2. **"Missing privacy policy"** — Already handled (curriculate.net/privacy).

3. **"Incorrect content rating"** — Use the questionnaire, don't guess.

4. **"Broken functionality"** — Test on a real device, not just the emulator. Make sure curriculate.net is live and responsive before submitting.

5. **"Missing permissions justification"** — Camera permission is justified by the core photo-grading feature. If Google asks, explain: "Camera is used to photograph student work for AI-powered grading."
