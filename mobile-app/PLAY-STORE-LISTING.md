# Pulse Grading — Google Play Console listing (paste-ready)

Verified against what the app actually does: teacher-only tool, anonymous by default,
no ads/third-party analytics/tracking, no GPS, no location prompt.

---

## 1. Main store listing

| Field | Value |
|---|---|
| App name (30 max) | `Pulse Grading` |
| Short description (80 max) | `Grade papers with AI. Photo → rubric → feedback in seconds. Free for teachers.` |
| Full description (4000 max) | *(see below)* |
| App category | Education |
| Tags | Study, Productivity, Teacher tools |
| Contact email | `rgsommer@me.com` |
| Contact phone | *(optional)* |
| Contact website | `https://curriculate.net` |
| Privacy Policy URL | `https://curriculate.net/privacy` |

**Full description** (copy verbatim)
```
Grade a stack of papers in minutes, not hours.

Pulse by Curriculate is the free AI grading tool built for teachers. Snap a photo of student work — handwritten or typed — set your rubric, and get detailed, personalized feedback in seconds.

Five ways to grade:
• Photo — point your camera at handwritten or printed work
• Paste — drop in typed answers or an essay
• Batch — upload a class-set PDF; Pulse splits and grades each student
• Video — grade speeches, drama, dance, or instrument performances
• Audio — grade music, singing, or recorded speech

Teacher-first features:
• 13 feedback voices, from encouraging coach to rigorous academic
• Use the built-in rubric or paste, describe, or upload your own
• Per-student strictness adjustment right on the results page
• Class roster linking so grades roll up to a student progress page
• PDF reports with a ref code students can look up online
• CSV export for Edsby and other gradebooks
• Optional email digest of results

Made for the real classroom:
• No account required — open the app and start grading
• Works on phones and tablets
• All your rubrics and rosters stay on your device unless you sign in

Free for all teachers. Curriculate is a small independent project — no ads, no student data resale, no third-party trackers.
```

---

## 2. Graphics assets

| Asset | Required size | Where |
|---|---|---|
| App icon | 512×512 PNG (32-bit) | `resources/play-store-icon.png` — verify dimensions |
| Feature graphic | 1024×500 PNG or JPG (no alpha) | `resources/feature-graphic.png` — verify dimensions |
| Phone screenshots | Min 2, max 8 · 16:9 or 9:16 · 320–3840 px per side | See `screenshot-spec.md` |
| 7" tablet screenshots | Recommended if tablet-supported | Same content, tablet framing |
| 10" tablet screenshots | Recommended if tablet-supported | Same content, tablet framing |
| Promo video (YouTube) | Optional | Leave blank at launch |

---

## 3. Data Safety form

### Data collection & sharing summary
- **Does your app collect or share any of the required user data types?** **Yes**
- **Is all user data collected encrypted in transit?** **Yes** (HTTPS end-to-end)
- **Do you provide a way for users to request their data be deleted?** **Yes** — via the "Contact us" link in-app or `curriculate.net/contact`. Teacher-side data is minimal and can be deleted on request; no persistent user record without opt-in.

### Data types collected

| Data type | Collected | Shared | Optional | Purpose | Notes |
|---|---|---|---|---|---|
| **Personal info → Email address** | Yes | No | Yes | App functionality, Communications | Only if teacher enters it for report emails / roster |
| **Personal info → Name** | Yes | No | Yes | App functionality | Only if teacher types student names on the roster |
| **Photos and videos → Photos** | Yes | No | Depends on mode | App functionality | Photos of student work (photo/batch modes) |
| **Photos and videos → Videos** | Yes | No | Depends on mode | App functionality | Uploaded videos (video mode only) |
| **Audio → Voice or sound recordings** | Yes | No | Depends on mode | App functionality | Uploaded audio (audio mode only) |
| **Files and docs** | Yes | No | Depends on mode | App functionality | PDF batch stacks |
| **App activity → App interactions** | Yes | No | No | Analytics | First-party grading usage counts |
| **Device or other IDs** | No | — | — | — | Not collected |
| **Location (approximate)** | Yes | No | No | Analytics | Country/city derived server-side from IP, aggregated |
| **Location (precise)** | No | — | — | — | Not collected |
| **Financial info** | No | — | — | — | No IAP at launch |
| **Health & fitness** | No | — | — | — | — |
| **Messages** | No | — | — | — | — |
| **Contacts** | No | — | — | — | — |
| **Web browsing history** | No | — | — | — | — |

### Security practices
- Data is encrypted in transit? **Yes**
- You provide a way for users to request their data be deleted? **Yes**
- Committed to Play's Families Policy (if targeting kids)? **No** — this is a teacher tool, not designed for children under 13 as end users. Target Audience is 18+ (educators).

---

## 4. Content rating

Complete the IARC questionnaire. Answer **No** to every content question. Expected result: **Everyone**.

Target audience for Play policy purposes: **Ages 18 and over** (educators).

---

## 5. Ads

**Does your app contain ads?** **No.**

---

## 6. App access

**Is all functionality in your app available without any special access?** **Yes.**

- No login screen at launch.
- Reviewer path: launch → tap "Paste" → paste sample text (see `APP-STORE-LISTING.md` §4 for the sample essay) → tap Submit.

If Google reviewer requests demo credentials, respond: "No account is required. Open the app to the grading page, tap Paste, and use the sample essay documented in the review notes."

---

## 7. News apps declaration
**Not a news app.**

---

## 8. COVID-19 declaration
**Does not qualify** (education/productivity, not health).

---

## 9. Government apps declaration
**Not a government app.**

---

## 10. Financial features declaration
**No financial features.** No cryptocurrency, no loans, no personal loans, no crypto exchange.

---

## 11. Health apps declaration
**Not a health app.**

---

## 12. Permissions justification (for sensitive permissions)

When Play reviews permissions, they may ask about:

- **CAMERA** — "Used by the in-app camera for teachers to photograph student work in the Photo and Batch grading modes. Runtime permission requested only when the teacher taps the camera. Declining leaves other input modes fully functional."
- **RECORD_AUDIO** — "Used by the in-page microphone recorder in Audio grading mode. Runtime permission requested only when the teacher starts a recording. Declining leaves Audio mode's file-upload path fully functional."
- **POST_NOTIFICATIONS** — "Used to deliver grade-completion notifications and optional weekly digests. Runtime permission requested with the standard system prompt on first send."

---

## 13. Release channels

- **Internal testing** first — verify install on a fresh device, verify all runtime permission prompts, verify camera/microphone actually work.
- **Closed testing** with a small group of trusted teachers before public.
- **Production** rollout: staged (20 % → 50 % → 100 %) over 3–5 days so any device-family crashes surface without hitting everyone.
