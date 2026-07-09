# Pulse Grading — App Store Connect listing (paste-ready)

Verified against what the app actually does: teacher-only tool, anonymous by default
(no login required at launch), no ads/third-party analytics/tracking, no GPS. Camera and
microphone are the only sensitive permissions, and both are optional per input mode.

---

## 1. App Information (General)

| Field | Value |
|---|---|
| Name | `Pulse Grading` |
| Subtitle (30 max) | `AI grading for teachers` |
| Bundle ID | `net.curriculate.pulse` |
| SKU | `curriculate-pulse` |
| Primary Category | Education |
| Secondary Category | Productivity |
| Age Rating | 4+ |
| Content Rights | Does NOT use third-party content |
| Support URL | `https://curriculate.net/contact` |
| Marketing URL | `https://curriculate.net/pulse` |
| Privacy Policy URL | `https://curriculate.net/privacy` |

---

## 2. Version information (1.0)

**Promotional Text** (170 max)
```
Snap a photo of student work — Pulse gives you rubric-matched feedback in seconds. Photo, paste, batch, video, or audio. Free for teachers, no login required.
```

**Description** (4000 max)
```
Grade a stack of papers in minutes, not hours.

Pulse by Curriculate is the free AI grading tool built for teachers. Snap a photo of student work — handwritten or typed — set your rubric, and get detailed, personalized feedback in seconds.

Five ways to grade:
• Photo — point your camera at handwritten or printed work
• Paste — drop in typed answers or an essay
• Batch — upload a class-set PDF, Pulse splits and grades each student
• Video — grade speeches, drama, dance, or instrument performances
• Audio — grade music, singing, or recorded speech

Teacher-first features:
• 13 feedback voices, from encouraging coach to rigorous academic
• Use the built-in rubric or paste, describe, or upload your own
• Per-student strictness adjustment right on the results page
• Class-roster linking so grades roll up to a student progress page
• PDF reports with a ref code students can look up online
• CSV export for Edsby and other gradebooks
• Optional email digest of results

Made for the real classroom:
• No account required — open the app and start grading
• Works on iPhone and iPad
• All your rubrics and rosters stay on your device unless you sign in

Free for all teachers. Curriculate is a small independent project — no ads, no student data resale, no third-party trackers.
```

**Keywords** (100 max, no spaces)
```
grading,teacher,rubric,AI,feedback,essay,handwriting,batch,report,marking,music,drama
```

**What's New in this Version**
```
Initial release. Photo, paste, batch, video, and audio grading. Class roster linking. PDF reports. CSV export.
```

**Screenshots** — iPhone 6.9" (1290×2796 or 1320×2868 for iPhone 15 Pro Max / 16 Pro Max) required; iPad 13" (2064×2752 or 2048×2732) required if you support iPad. See `screenshot-spec.md` for scene list.

---

## 3. App Privacy questionnaire

**Data collection:** Yes, this app collects data.
**Tracking:** NO — the app does not track users across apps/sites. No ad SDKs. No third-party analytics.

For each type, Apple asks: Purpose · Linked to identity? · Used for tracking?

| Data type (category) | Collected? | Purpose | Linked? | Tracking? |
|---|---|---|---|---|
| **Email Address** (Contact Info) | Yes — *optional*, only if a teacher enters it to receive report emails or link a roster | App Functionality | **Yes** | **No** |
| **Name** (Contact Info) | Yes — *optional*, only if a teacher enters student names (roster or manual) | App Functionality | **Yes** | **No** |
| **Photos or Videos** (User Content) | Yes — photos of student work, uploaded videos | App Functionality | **No** | **No** |
| **Audio Data** (User Content) | Yes — audio-grading uploads | App Functionality | **No** | **No** |
| **Other User Content** (User Content) | Yes — pasted answer text, rubric text, feedback | App Functionality | **No** | **No** |
| **Product Interaction** (Usage Data) | Yes — grading-usage counts (first-party, no third-party analytics) | Analytics | **No** | **No** |
| **Coarse Location** (Location) | Yes — approximate country/city derived server-side from IP for usage stats (never shared, never stored per-teacher after aggregation) | Analytics | **No** | **No** |

Do NOT declare: Precise Location (no GPS), Contacts, Health, Financial, Browsing History, Search History, User ID beyond email, Purchases (no IAP at launch — see §6 below), Identifiers for Advertisers.

**Camera / Microphone** are device-permission usage (declared in Info.plist), not separate privacy data types — the media captured is covered by Photos/Audio above.

**Third-party AI processing disclosure:** the app sends the photo/audio/text you grade to OpenAI's API for the grading step. OpenAI processes but does not retain this data for training on our account. Mention this in the description above and in `/privacy` — reviewers should not be surprised.

---

## 4. App Review Information

**Sign-In Required:** OFF (no account).

**Contact:** Richard / Sommer / (your phone) / rgsommer@me.com

**Notes to Reviewer:**
```
Pulse Grading is a teacher tool for AI-assisted grading of student work.
No login or purchase is required to review the app.

To review WITHOUT needing real student work on paper:

1. Launch the app. You'll land on the grading page.
2. Tap "Paste" in the Input mode row. A text box appears.
3. Paste this sample essay:
   "The Water Cycle
    Water on Earth moves in a cycle. First the sun heats water in oceans
    and lakes. The water evaporates and rises. It cools and forms clouds.
    When clouds are heavy, water falls as rain or snow. The water flows
    back to oceans and the cycle continues."
4. Leave Grade Band on 6-8, tap "Submit". Feedback appears in ~10s.

Alternatively:
- Tap "Photo" to test the camera; the camera prompt is skippable — you
  can also tap "Upload" to pick any photo from the library.
- Batch, Video, and Audio modes each work with any file of the right type.

The app has no in-app purchases, no ads, no third-party tracking, and no
required account. Camera and microphone prompts appear only for the input
modes that use them; the app remains fully usable if declined (paste mode
never asks).
```

**Attached document:** none needed. A demo screen recording is optional.

---

## 5. Age Rating questionnaire

Answer **None / No** to every content question (violence, profanity, sexual content, gambling, horror, mature/suggestive, contests, medical/treatment information, unrestricted web access). Result: **4+**.

Note: the app is a teacher tool and does not display student-authored content to third parties. There is no unrestricted web browsing.

---

## 6. In-App Purchases

**None at launch.** The app is free with no unlockable content. Do NOT enable any IAP or subscription products on this submission.

Freemium tier is scheduled to activate 2026-11-30 (see `shared/freemiumConfig.js`).
Before that date the app is fully free and the paywall UI never renders. The activation is a **server-side change** that will require:
- Introducing Apple StoreKit IAP for the "Plus" tier (mandatory for any digital feature unlock inside the iOS app — external links to Stripe checkout would violate Apple 3.1.1).
- A new App Store submission with IAP products configured.
- Updated App Privacy → "Purchases" (User Content: Yes, Purpose App Functionality).
- Optional: implement Sign in with Apple (Apple 4.8) if the paywall path involves an account. If Plus remains anonymous (session-scoped), SIWA is not required.

Docs: see `SUBMISSION_CHECKLIST.md` §Post-launch freemium.

---

## 7. Version history / Test information

For TestFlight:
- Add reviewers (rgsommer@me.com) as internal testers.
- Include a build note referencing the "Paste" review path above.
- Skip Beta App Review by keeping the tester list internal until the public submission.
