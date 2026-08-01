# What this drop contains

Merged into the existing `frontend/` Next.js app. Adds 22 files, changes none, installs nothing.

- `frontend/src/app/opportunities/**` — landing, free scan, paywall, report viewer
- `frontend/src/app/api/opportunities/**` — scan, checkout, generate, report, stripe-webhook
- `frontend/src/lib/opportunities/**` — prompts, schemas, store, anthropic, stripe, email, ratelimit
- `docs/opportunities-setup.md` — env vars, the Supabase table, the Stripe webhook, the checklist

Written for the stack that is actually there: Next 14 App Router (plain `params`, not promises),
React 18, Tailwind v4 (stock palette only — no custom theme keys, so nothing needs adding to
`tailwind.config.js`), Stripe and Resend already installed, Supabase for storage.

Nothing is wired into your navigation. Add a link to `/opportunities` when you are ready.
