# Pulse Grading — Screenshot spec

Actual screenshots need to be captured on a real device (or Simulator/Emulator
at the exact resolution the store expects). This file is the shot list + size
matrix — hand it to whoever captures the images.

---

## App Store — required sizes

Apple only requires ONE iPhone size and ONE iPad size (if you support iPad),
but the store will letterbox/pillarbox smaller sizes to fit larger frames.
Capturing at the largest listed size once means fewer re-shoots.

### iPhone (required)

| Device family | Screen | Portrait pixels | Landscape pixels |
|---|---|---|---|
| **iPhone 16 Pro Max / 15 Pro Max — required** | 6.9" / 6.7" | **1320 × 2868** | 2868 × 1320 |
| iPhone 6.5" (fallback, still accepted) | 6.5" | 1284 × 2778 | 2778 × 1284 |
| iPhone 5.5" (older, only if you want it) | 5.5" | 1242 × 2208 | 2208 × 1242 |

Capture on iPhone 16 Pro Max Simulator (or a real device that size) at 3× scale.
Portrait for the app's primary flows; landscape optional and only for scenes
that visibly benefit (batch results grid).

### iPad (required if you support iPad)

| Screen | Portrait pixels | Landscape pixels |
|---|---|---|
| **iPad Pro 13" (M4) — required for new submissions** | **2064 × 2752** | 2752 × 2064 |
| iPad Pro 12.9" (older, still accepted) | 2048 × 2732 | 2732 × 2048 |

Capture on iPad Pro 13" Simulator at 2× scale.

Min 2, max 10 per family. Use 5 — enough to tell the story, few enough to keep
them all high-quality.

---

## Play Store — required sizes

Google Play is more flexible. Aspect ratio must be between 16:9 and 9:16,
and each side must be 320–3840 px.

| Type | Recommended pixels | Notes |
|---|---|---|
| Phone screenshots (2–8) | **1080 × 1920** portrait | 9:16, the default phone frame |
| 7" tablet (optional but improves listing) | **1200 × 1920** portrait | |
| 10" tablet (optional but improves listing) | **1800 × 2560** portrait | |
| Feature graphic (already have `resources/feature-graphic.png`) | **1024 × 500** (JPG or PNG, no alpha) | Verify existing file size below |
| App icon (already have `resources/play-store-icon.png`) | **512 × 512** (32-bit PNG) | Verify existing file size below |

---

## The shot list — 5 scenes

Every shot follows the same story arc: teacher opens app → grades → gets
feedback → shares result. Same scenes for both stores; only aspect ratio changes.

### Shot 1 — Photo of a paper being graded

- **What's on screen:** the grading page in Photo mode, camera live-view
  framed on a handwritten essay (use any sample), the "Capture Photo" button
  visible.
- **Caption overlay (optional, add in Figma):**
  *"Snap. Grade. Done."*
- **Purpose:** immediately communicates "this app grades photos of real
  student work" — the single most important message.

### Shot 2 — Feedback appearing after grading

- **What's on screen:** results view showing an overall grade (e.g. 18/20),
  section breakdown, strengths, next steps, and a teacher comment.
- **Caption overlay:**
  *"Rubric-matched feedback in seconds."*
- **Purpose:** shows the actual output. This is what teachers care about
  most — the quality of the feedback.

### Shot 3 — Batch grading a class

- **What's on screen:** BatchGrading results grid with 6–8 students visible,
  each with a letter grade / percentage.
- **Caption overlay:**
  *"Grade a whole class from one PDF."*
- **Purpose:** shows scale. Teachers see the time savings.

### Shot 4 — Feedback voice picker

- **What's on screen:** the voice selector open, showing "Warm", "Coach",
  "Rigorous academic", etc. (13 total, but you only need to see ~5 to
  communicate the concept).
- **Caption overlay:**
  *"13 feedback voices to match your class."*
- **Purpose:** differentiates from generic AI graders.

### Shot 5 — Student progress dashboard

- **What's on screen:** the /progress view for one student showing recent
  grades and a trendline.
- **Caption overlay:**
  *"Grades roll up per student, automatically."*
- **Purpose:** shows the ecosystem — this isn't a one-off grader, it feeds
  a real progress tracker.

### Optional Shot 6 — Video / audio performance grading

- **What's on screen:** Video mode with a small performance video queued and
  a per-student result card visible.
- **Caption overlay:**
  *"Music, drama, and speech performances too."*
- **Purpose:** shows the recently added multi-performer capability, which
  most competitors don't have.

---

## Capture workflow

**Simulator route (fastest, no device needed):**

```bash
# iOS
open -a Simulator
# In Simulator: Device menu → iPhone 16 Pro Max (or iPad Pro 13")
# Load your dev build (or point Safari at https://www.curriculate.net/grading)
# ⌘S — saves screenshot to Desktop at exact device pixels.

# Android
$ANDROID_HOME/emulator/emulator -avd Pixel_8_Pro_API_35
# Load app
# On emulator toolbar: camera icon → saves at exact device pixels.
```

Screenshots taken this way are already at the required size. No Figma
resizing needed unless you're adding caption overlays.

**Real device route (higher quality, needed for camera live-view shots):**

Real photos of paper always look better than Simulator screenshots that are
just showing a mock camera view. For Shot 1 specifically:

- Grab an iPhone with a large display (16 Pro Max preferred).
- Open the app to Photo mode.
- Frame a real handwritten paragraph on paper.
- Screenshot (Side + Volume Up).
- Airdrop to Mac.
- Verify the resulting PNG is 1320 × 2868. If it's a different size, the
  device is smaller than 6.9" — retake on a 6.9" device or use the
  Simulator for that shot.

---

## Add caption overlays

Optional but recommended — bare screenshots look generic. Simplest workflow:

- Import each screenshot into Figma.
- Add a full-bleed caption bar at the top (e.g. purple `#2563eb`, 8 % of
  screen height, white text, SF Pro / Roboto).
- Export at 100 % — no resizing.

For minimum effort, skip captions and let the screenshots speak. Apple/Google
both let you upload plain screenshots with no overlays.

---

## Verify what's already on disk

Run this to sanity-check the assets that already exist:

```bash
cd mobile-app/resources
sips -g pixelWidth -g pixelHeight play-store-icon.png
sips -g pixelWidth -g pixelHeight feature-graphic.png
sips -g pixelWidth -g pixelHeight icon.png
sips -g pixelWidth -g pixelHeight splash.png
```

Expected:
- `play-store-icon.png` → 512 × 512
- `feature-graphic.png` → 1024 × 500
- `icon.png` → 1024 × 1024 (Apple / Play master icon)
- `splash.png` → 2732 × 2732 (Capacitor splash master; Capacitor Assets
  resizes to every needed platform target)

If any dimension is off, regenerate that asset from the 1024 icon source
before uploading.

### ⚠️ Current state — must fix before iOS submission

At the time of writing, `mobile-app/resources/`:
- ✅ `play-store-icon.png` — 512 × 512 (correct)
- ✅ `feature-graphic.png` — 1024 × 500 (correct)
- ❌ `icon.png` — **1408 × 768** (should be 1024 × 1024 square)
- ❌ `splash.png` — **1408 × 768** (should be 2732 × 2732 square)

The Android launcher icons under `android/app/src/main/res/mipmap-*` are
already generated correctly (visible in the built app), so Play Store
submission is not blocked by this. But:

- **iOS submission will fail** — Apple requires a 1024×1024 App Store icon
  and Capacitor Assets can't derive a proper iOS AppIcon set from a
  non-square source.
- **Any future re-run of `npx capacitor-assets generate` will regenerate
  Android and iOS icons from these sources** — the currently-shipped
  Android icons will be replaced with distorted ones.

**How to fix:**

1. Take the actual Pulse logo mark at its full resolution (whatever your
   original design file is — likely 2048 × 2048 or 4096 × 4096 SVG-rendered).
2. Export it as a **square** PNG:
   - `resources/icon.png` at 1024 × 1024 with a transparent (or #ffffff)
     background — no rounded corners; both stores mask the corners for you.
   - `resources/splash.png` at 2732 × 2732 with the logo mark centered on a
     `#2563eb` background (or transparent — the `--splashBackgroundColor`
     arg in the `icons` npm script controls the final background).
3. Regenerate:
   ```bash
   cd mobile-app
   npm run icons
   ```
   This runs `capacitor-assets generate` which rebuilds every Android
   mipmap + every iOS AppIcon size + splash screens from the fresh
   sources.
4. Verify sizes on disk again with `sips` before committing.

If you don't have a native square logo source, the fastest path is to
crop `pulse-icon.png` (which is 1408 × 768 landscape) — you likely have the
mark centered inside a wider frame; use ImageMagick or Photoshop to crop
to a 768 × 768 square and then upscale to 1024 × 1024 with a design tool
that can handle vector edges (Figma export at 2× is fine if the mark was
originally vector).
