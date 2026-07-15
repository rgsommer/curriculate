# Curriculate Student — App Store Connect listing (paste-ready)

Verified against what the app actually does (no third-party analytics/ads/tracking,
no GPS; optional email; photo/audio upload for some task types).

---

## 1. App Information (General)

| Field | Value |
|---|---|
| Name | `Curriculate Student` |
| Subtitle (30 max) | `Play live classroom games` |
| Bundle ID | `net.curriculate.student` |
| SKU | `curriculate-student` |
| Primary Category | Education |
| Secondary Category | Games → Educational |
| Age Rating | 4+ |
| Content Rights | Does NOT use third-party content |
| Support URL | `https://curriculate.net/contact` |
| Marketing URL | `https://curriculate.net` |
| Privacy Policy URL | `https://curriculate.net/privacy` |

---

## 2. Version information (1.0)

**Promotional Text** (170 max)
```
Join your class's live game with a room code and play interactive task stations right on your phone or tablet. No account needed — ask your teacher for a code and jump in.
```

**Description** (4000 max)
```
Join the game. Play the lesson.

Curriculate Student is how your class joins and plays live Curriculate sessions. Your teacher shows a room code — enter it, name your team, and start playing interactive task stations right on your phone or tablet.

What you can do:
• Join a live session with a room code — no account needed
• Play 20+ task types: quizzes, sorts, matching, mind maps, sequences, and more
• Scan station QR codes to move through the hunt
• Record answers, take photos, and complete challenges
• See your team climb the live leaderboard

Made for classrooms:
• Works on iPhone and iPad
• Fast join-by-code — students are playing in seconds
• Built for class sets of shared devices

Ask your teacher for a room code and jump in.
```

**Keywords** (100 max, no spaces)
```
classroom,game,student,join,quiz,scavenger,hunt,team,learning,session,code,play,matching
```

**Screenshots** — iPhone 6.7"/6.9" + iPad 13" (2064×2752 or 2048×2732). Suggested: a task mid-play (matching), the live leaderboard/victory, a second task type, the join screen.

---

## 3. App Privacy questionnaire

**Data collection:** Yes, this app collects data.
**Tracking:** NO — the app does not track users across apps/sites. No ad SDKs, no third-party analytics.

For each type, Apple asks: Purpose · Linked to identity? · Used for tracking?

| Data type (category) | Collected? | Purpose | Linked? | Tracking? |
|---|---|---|---|---|
| **Email Address** (Contact Info) | Yes — *optional*, only if a student enters it for a personal report | App Functionality | **Yes** | **No** |
| **Photos or Videos** (User Content) | Yes — photo task types | App Functionality | **No** | **No** |
| **Audio Data** (User Content) | Yes — audio/recording task types | App Functionality | **No** | **No** |
| **Other User Content** (User Content) | Yes — typed answers, team & member names | App Functionality | **No** | **No** |
| **Product Interaction** (Usage Data) | Yes — session/gameplay analytics (first-party) | Analytics | **No** | **No** |

Do NOT declare: Location (no GPS), Contacts, Health, Financial, Browsing History, Identifiers-for-ads, Purchases.

**Camera / Microphone / Motion** are device-permission usage (declared in Info.plist), not separate privacy data types — the media captured is covered by Photos/Audio above.

---

## 4. App Review Information

**Sign-In Required:** OFF (no account).

**Contact:** Richard / Sommer / (your phone) / rgsommer@me.com

**Notes:**
```
Curriculate Student is how students join and play live classroom game
sessions run by their teacher. Normally a teacher starts a session and
shares a room code.

To review WITHOUT needing a teacher or a second device, we've set up a
self-running demo room:

1. Launch the app.
2. On the join screen, enter room code: CRUEDEMO
3. Enter any team name (e.g. "Reviewers") and one member name.
4. Tap "Join Room". The demo session auto-starts within a couple of
   seconds — no teacher needed.
5. Play through the tasks (a short "Water Cycle" set). Camera and
   microphone prompts appear only for optional task types and can be
   declined; the app remains fully usable.

No account, purchase, or teacher device is required to review the app.
```

---

## 5. Age Rating questionnaire

Answer **None / No** to every content question (violence, profanity, sexual content, gambling, horror, mature/suggestive, contests, unrestricted web). Result: **4+**.

---

## 6. App Review history / standing answers

**Rejection 2026-07-15 (v1.0 build 6), two items — both resolved:**

- **2.3.10 Accurate Metadata:** description mentioned "Android tablets." Fix: description must not reference other platforms. Bullet changed to "Works on iPhone and iPad" (Android line is Play-only). Keep all Apple metadata Android-free.
- **2.1(b) Information Needed (business model):** standing answer — the student app is **free, no account, no IAP, no paid unlocks**. Students join a teacher-hosted session with a room code and never pay. Teachers subscribe separately on curriculate.net (B2B SaaS, on the web, outside the app); that purchase is never surfaced, linked, or unlocked in the student app. No enterprise services are sold in-app. Reply with these answers verbatim if 2.1(b) recurs.
