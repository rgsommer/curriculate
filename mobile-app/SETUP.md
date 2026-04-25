# Curriculate Pulse — Mobile App Setup

## Architecture

This is a **live-URL Capacitor wrapper**. The app loads `curriculate.net` inside
a native WebView and adds native capabilities on top:

- **Camera** — native camera picker instead of browser file input
- **Push notifications** — grade alerts delivered as native push
- **Haptics** — subtle feedback on grade reveal
- **Deep links** — `curriculate.net/results/AB123` opens in the app
- **In-app subscriptions** — Apple/Google payment flow (when ready)

The web app runs from your server, so updates ship instantly without
resubmitting to the stores.

## Prerequisites

- Node.js 18+
- Xcode 15+ (for iOS)
- Android Studio (for Android)
- Apple Developer account ($99/year)
- Google Play Developer account ($25 one-time)

## Quick Start

```bash
cd mobile-app

# Install dependencies
npm install

# Copy the Pulse icon for splash/app icon generation
cp ../frontend/public/images/pulse/pulse-icon.png resources/icon.png
cp ../frontend/public/images/pulse/pulse-logo.png resources/splash.png

# Generate app icons and splash screens from your logo
npm run icons

# Build the fallback web page
npm run build:web

# Add platforms
npm run cap:add:ios
npm run cap:add:android

# Sync web assets + plugins to native projects
npm run cap:sync

# Open in Xcode
npm run cap:open:ios

# Open in Android Studio
npm run cap:open:android
```

## Project Structure

```
mobile-app/
├── capacitor.config.ts    # Capacitor config (live URL, plugins)
├── package.json           # Dependencies + scripts
├── index.html             # Fallback page shown while loading
├── www/                   # Web assets (built from index.html)
├── src/
│   └── native-bridge.js   # JS bridge: camera, push, haptics, deep links
├── ios/                   # Generated Xcode project
├── android/               # Generated Android Studio project
├── resources/             # Source images for icon/splash generation
├── store-metadata.md      # App Store / Play Store listing copy
└── SETUP.md               # This file
```

## Native Bridge

The `native-bridge.js` module exposes `window.CurriculateNative` to your web app:

```javascript
// Check if running in native app
if (window.CurriculateNative?.isNative) {
  // Use native camera instead of file input
  const photo = await window.CurriculateNative.takePhoto();
  if (photo) {
    // photo is a data URL, use it like any image
  }

  // Register for push notifications
  const token = await window.CurriculateNative.registerPush();
  // Send token to your backend for grade alerts

  // Haptic feedback
  await window.CurriculateNative.hapticLight();
}
```

## Web App Integration

Add this to your grading page to detect the native app and use native camera:

```javascript
// In your photo upload handler:
async function handlePhotoUpload() {
  if (window.CurriculateNative?.isNative) {
    // Use native camera
    const dataUrl = await window.CurriculateNative.takePhoto();
    if (dataUrl) processImage(dataUrl);
  } else {
    // Fall back to file input
    fileInputRef.current.click();
  }
}
```

## In-App Subscriptions (Phase 2)

When you're ready to add paid plans:

1. Install `@capgo/capacitor-purchases` (RevenueCat wrapper)
2. Configure products in App Store Connect / Google Play Console
3. Wire up subscription checks in your web app
4. Apple requires: if you offer subscriptions in-app, you MUST use
   their payment system (30% cut, 15% after year 1 via Small Business Program)

You can offer both web subscriptions (Stripe, full margin) and in-app
subscriptions (Apple/Google, with their cut). Many apps price in-app
subscriptions slightly higher to offset the fee.

## App Store Review Tips

Apple rejects "thin wrappers." To pass review, emphasize:

1. **Native camera** — better photo quality than browser file picker
2. **Push notifications** — grade alerts, weekly digests
3. **Haptic feedback** — tactile response on interactions
4. **Deep links** — result codes open directly in the app
5. **Offline viewing** — cache recent results for offline access (future)

In your review notes, write:
> "This app provides native camera integration for photographing student
> work, push notifications for grade alerts, and haptic feedback. The
> grading engine runs server-side for accuracy and security. The app
> requires a network connection for AI grading but provides native
> capabilities that enhance the mobile experience beyond what a web
> browser can offer."

## Deployment Checklist

### iOS (App Store)
- [ ] Xcode project builds and runs on simulator
- [ ] App icons generated (1024x1024 source → all sizes)
- [ ] Splash screen configured
- [ ] Camera permission string in Info.plist
- [ ] Push notification entitlement enabled
- [ ] App Store Connect listing created
- [ ] Screenshots captured (6.7", 6.5", 5.5" iPhones + iPad)
- [ ] Privacy policy URL set (curriculate.net/privacy)
- [ ] App Review notes written
- [ ] TestFlight build uploaded and tested

### Android (Play Store)
- [ ] Android Studio project builds and runs on emulator
- [ ] Adaptive icons generated
- [ ] Splash screen configured
- [ ] Camera permission in AndroidManifest.xml
- [ ] Push notification setup (Firebase Cloud Messaging)
- [ ] Play Console listing created
- [ ] Screenshots captured (phone + 7" tablet + 10" tablet)
- [ ] Privacy policy URL set
- [ ] Internal testing track build uploaded
- [ ] Production release submitted
```
