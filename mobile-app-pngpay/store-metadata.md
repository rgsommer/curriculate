# PNGPay — App Store & Play Store Metadata

The mobile companion to TeeBee's payroll suite, carrying the PNGPay name your
users already know. Supervisors submit their team's hours and leave from the
job site; the office bookkeeper approves and pays. Loads the live app in a
native shell, so it's always up to date.

- **App ID:** `net.curriculate.pngpay`
- **App name:** PNGPay
- **Loads:** `https://www.curriculate.net/teebeepay/app?app=1&view=team`
- **Sign-in:** email + one-time PIN (first-party; no social login)

---

## App Name
**PNGPay**

## Subtitle (App Store, 30 chars max)
Team hours, from the field

## Short Description (Play Store, 80 chars max)
Supervisors submit team hours & leave on the go. Bookkeeper approves & pays.

## Full Description

**Submit your team's hours from wherever the work is.**

PNGPay is the on-site companion to your TeeBee payroll — built for Papua New
Guinean businesses. Supervisors record each team member's hours and leave for
the pay period right from their phone, then the office bookkeeper reviews,
approves, and pays.

**What you can do:**
• See your team for the current pay period at a glance
• Enter hours per person, per day — including overtime
• Record leave and absences (annual, sick, unpaid, and more) with notes
• Add a quick note against anyone's pay for the bookkeeper
• Submit the whole team in one tap when the period closes

**Built for how payrolls actually run:**
• Your entries flow straight to the bookkeeper for approval — no paper, no
  WhatsApp photos of timesheets
• Everything stays in sync with the office; no double entry
• Works on modest connections

**Who it's for:**
Site supervisors, team leads, and division managers who are responsible for
their crew's time but don't run the payroll themselves.

PNGPay requires an account. Your administrator sets you up as a supervisor and
you sign in with your email and a one-time code.

## Keywords (App Store, 100 chars max)
payroll,timesheet,hours,supervisor,team,leave,roster,attendance,PNG,kina

## Categories
- Primary: Business
- Secondary: Productivity

## Age Rating
4+ (no objectionable content)

---

## Privacy / Data Safety

Declare these truthfully on both stores (App Privacy / Data safety form):

| Data | Collected | Purpose | Linked to user | Tracking |
|------|-----------|---------|----------------|----------|
| Email address | Yes | Account sign-in (email-PIN) | Yes | No |
| Name | Yes | Identify supervisor & team members | Yes | No |
| Employment info (hours, leave) | Yes | Core app function — payroll input | Yes | No |

- **No advertising. No third-party tracking. No location. No camera.**
- Data is transmitted over HTTPS and processed for payroll.
- Privacy policy: https://www.curriculate.net/privacy
- Account deletion: handled by the account administrator; contact
  info@teebeeaccountants.com.pg

## Support
- Support URL: https://www.curriculate.net/contact  *(required by App Store 1.5)*
- Support email: info@teebeeaccountants.com.pg
- Marketing URL (optional): https://www.curriculate.net/teebee

---

## App Review Notes (paste into "Notes for Review")

> PNGPay is a role-specific companion to the TeeBee payroll platform (PNGPay is
> the established name for this payroll system in Papua New Guinea). Site
> supervisors use it to submit their team's hours and leave for a pay period;
> the office bookkeeper then approves and processes payroll in the main web app.
>
> **Sign-in is email + one-time PIN (a first-party mechanism). The app does
> not offer any third-party or social login, so Sign in with Apple (4.8) does
> not apply.**
>
> The app is account-gated, so please use the demo supervisor account below.
> It is pre-loaded with a sample company and team so you can see the full
> flow: view team → enter hours/leave → submit for approval.
>
> Native capabilities beyond the web experience: haptic feedback, Android
> back-button handling, and a WebView locked to the payroll app (external links
> open in the system browser). No camera, location, or push notifications are
> used.

**Demo account (seeded in production — ready for reviewers):**
- Sign-in URL: `https://www.curriculate.net/teebeepay/app?view=team`
- Email: `reviewer@teebeeaccountants.com.pg`  (supervisor of the "Site Crew" division, "supervisor submits hours" = on)
- PIN: `246810`  (fixed review PIN — no mailbox needed)
- Company: "PNGPay Demo Co", team: Joe Kaupa, Mary Wari, Peter Namaliu, Grace Bani

  This account is pre-seeded (scripts/seed-demo-supervisor.mjs) and uses a
  fixed PIN via the server's `DEMO_REVIEW_EMAIL` + `DEMO_REVIEW_PIN` env vars,
  so reviewers sign in with the code above — no email inbox required. Sign in
  with Apple (4.8) does not apply (first-party email-PIN only).
  ⚠️ The PIN above MUST match the `DEMO_REVIEW_PIN` env var set on the server.

---

## Screenshots Needed (prepare these)

Capture on the live app signed in as the demo supervisor:
1. **My team** — the team list for the current period
2. **Enter hours** — per-person hours with a day expanded
3. **Record leave** — leave-type picker with a note
4. **Ready to submit** — the whole team filled in, submit button visible
5. **Confirmation** — "submitted for approval" state
6. (Tablet) the team screen at 7"/10" width

Required sizes:
- **iOS:** 6.7" and 6.5" iPhone (portrait); 12.9" iPad if you enable iPad.
- **Android:** phone (≥ 2 shots), plus 7" and 10" tablet if targeting tablets.
- **Play feature graphic:** 1024×500 PNG (navy #0f2c52 background, gold Kina mark).

## App Preview Video (optional, 15–30s)
Open app → sign in → team appears → tap a name, enter hours → record a leave day
→ submit → "sent to bookkeeper for approval." End card: "PNGPay — payroll for PNG."
