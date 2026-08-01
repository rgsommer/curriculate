# /opportunities — setup and operations

The Opportunity Gap Analysis product, merged into the existing `frontend/` Next.js app.
Live at `https://www.curriculate.net/opportunities`. **No new npm dependencies** — it uses `stripe`
and `resend`, both already installed, and calls the Anthropic API over plain `fetch`.

## What was added

```
frontend/src/app/opportunities/                  Landing, free scan, paywall, report viewer
frontend/src/app/api/opportunities/              scan · checkout · generate · report · stripe-webhook
frontend/src/lib/opportunities/                  prompts (the product), schemas, store, anthropic, stripe, email, ratelimit
```

Every route is namespaced under `/api/opportunities/*` so nothing collides with the existing
teebeepay, campfire or grading endpoints. The Stripe webhook is a **separate endpoint with its own
signing secret** and ignores any event whose `metadata.product` is not `opportunities`.

## 1. Environment variables (Vercel)

You already have `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY` and `RESEND_API_KEY`. Add:

| Variable | Value | Notes |
|---|---|---|
| `OPP_PRICE_CENTS` | `2999` | |
| `OPP_CURRENCY` | `cad` | |
| `OPP_STRIPE_WEBHOOK_SECRET` | `whsec_…` | From step 3. **Separate from any existing webhook secret.** |
| `OPP_SCAN_MODEL` | `claude-sonnet-4-5` | Free tier runs on the cheaper model by design |
| `OPP_REPORT_MODEL` | `claude-opus-4-6` | |
| `OPP_MAX_SEARCHES_FREE` | `6` | |
| `OPP_MAX_SEARCHES_PAID` | `60` | Biggest single lever on both quality and cost |
| `OPP_EMAIL_FROM` | `Curriculate <reports@curriculate.net>` | Must be a verified Resend sender |
| `OPP_COMP_EMAILS` | your email | Generate reports without paying, for testing |
| `NEXT_PUBLIC_SITE_URL` | `https://www.curriculate.net` | Probably already set |

## 2. Storage

The store auto-selects a backend. **Supabase is used if `SUPABASE_SERVICE_ROLE_KEY` is set**, which
it should be. Run this once:

```sql
create table if not exists opportunity_kv (
  key         text primary key,
  value       jsonb not null,
  expires_at  timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists opportunity_kv_expires_idx on opportunity_kv (expires_at);
alter table opportunity_kv enable row level security;
-- No policies: the service-role key bypasses RLS, and nothing else should touch this table.
```

If you would rather not add a table, set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
instead and the store switches automatically. With neither, it writes to `.data/` — dev only.

## 3. Stripe webhook

Dashboard → Developers → Webhooks → **Add endpoint**
- URL: `https://www.curriculate.net/api/opportunities/stripe-webhook`
- Event: `checkout.session.completed`
- Copy the signing secret into `OPP_STRIPE_WEBHOOK_SECRET`

The handler ignores events from your other products, so this endpoint is safe to add alongside
whatever webhooks teebeepay and campfire already use.

## 4. How report generation works

A full report is four large model calls with web search — far more than one serverless invocation.
`/api/opportunities/generate` therefore advances **exactly one phase per call**, and the report page
polls and re-triggers. This works on a 60-second function limit and on an 800-second one, with no
queue, worker or cron.

Phases: profile + peer group → top 25 opportunities (with net income projections) → expansions and
supporting lists → three launch packages + appendix.

State lives in `opportunity_kv`, so a user can close the tab and come back; Resend emails them the
link when it finishes.

## 5. The method (why this is not a chatbot answer)

`frontend/src/lib/opportunities/prompts.ts` is the product. Two things make it different:

**Seven opportunity types, not one.** Absent · undersupplied · capacity-constrained · quality gap ·
segment gap · format gap · exiting. A missing business is the least interesting finding; the money is
usually in categories that already exist and are served badly. Underserved findings carry a higher
evidence bar — ratings, review volume, published wait times, capacity statements — because "the
incumbents are bad" is easy to assert and hard to prove.

**Four elimination rules.** The leakage test (a gap is not a gap if three providers sit ten minutes
away), physical presence (advertising in a city is not being in it), income is not demand, and — for
quality and capacity gaps specifically — *what stops the incumbent simply fixing this the day you
open?* If the answer is "nothing", the report says so.

Every opportunity carries a bottom-up net income projection: volume × price, cost of delivery,
itemised fixed costs, net income for years 1–3 before owner's salary, and months to breakeven. Where
a business cannot support a full-time owner's income, the report states it plainly.

## 6. Pre-launch checklist

- [ ] `npm run build` passes in `frontend/`
- [ ] Free scan completes for three cities, including one outside Canada
- [ ] **Read every teaser hint yourself** — no actionable business name should leak into the free tier
- [ ] Type breakdown shows more than just "absent"
- [ ] Rate limit fires after 5 uncached scans in an hour
- [ ] Checkout completes and the webhook marks the order paid
- [ ] Report generates through all four phases and every opportunity shows a net income projection
- [ ] Resend email arrives with a working link
- [ ] `/api/opportunities/report/<id>` returns 402 for an unpaid id
- [ ] Print-to-PDF is legible
- [ ] Refund policy decided before the first unhappy customer, not after

## 7. Cost and pricing

Roughly **$0.25 per uncached free scan** and **$4.35 per report** (estimates — replace with actuals
after ten real runs). At $29.99 CAD that is roughly 69% contribution margin after Stripe fees and
attributable scan cost.

Free-scan cost is the whole risk, because it scales with traffic rather than revenue. Three defences
in order: city caching (built, 14-day TTL), rate limiting (built), and gating the scan behind an email
if conversion settles below 2%.

**$29.99 is probably too low.** The buyer is deciding whether to commit tens of thousands of dollars,
and the most valuable content is the false-positive list — the year it stops them wasting. Launch
there to learn what people actually want, ask every buyer what decision they were making, and price a
$249–499 tier from the answers.

## 8. Next

1. Spreadsheet export — `xlsx` is already a dependency; one row per opportunity with the scoring inputs.
2. Report refresh sold annually; the city cache and phase machine already support it.
3. Accounts, but only once someone asks to buy a second city.
