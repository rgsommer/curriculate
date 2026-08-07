# /businesses — setup and what changed

Live at `https://www.curriculate.net/businesses`. The older `/opportunities` section is left
untouched and still works exactly as before; nothing was deleted.

## Open this first if anything misbehaves

```
https://www.curriculate.net/api/businesses/health
```

Returns a plain list of what is misconfigured, plus a live storage read/write test.
Booleans only — no secret values are ever returned.

## Required setup — the Supabase table

This is almost certainly what was breaking `/opportunities`. `kvGet` threw on a missing table,
nothing caught it, the function died, and the browser received an **empty 500** — which surfaces
as "Unexpected end of JSON input".

```sql
create table if not exists opportunity_kv (
  key         text primary key,
  value       jsonb not null,
  expires_at  timestamptz
);
alter table opportunity_kv enable row level security;
-- service role bypasses RLS; no policy needed for server-side access
```

Set `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` in Vercel. Without a working
backend the store falls through to local disk, which is ephemeral on Vercel — the health
endpoint now says so explicitly instead of failing silently.

## What is different from /opportunities

1. **Storage never throws unguarded.** A typed `StorageError` carries a specific hint when the
   table is missing, and `withApi()` wraps every route so no handler can return an empty body.
2. **The scan is asynchronous.** `POST /api/businesses/scan` creates the record and returns in
   under a second; `POST /api/businesses/scan-run` does the model work, driven by the scan
   page's poller. The old version ran the full 40–90 second analysis inline and exceeded the
   serverless time limit, which is what produced "Failed to fetch".
3. **`safeFetchJson` on the client** reads the body as text first, so a crash produces a useful
   message instead of a JSON parse error.
4. **Updated methodology** in `src/lib/businesses/prompts.ts` — the substantive change. It now
   runs two peer groups (proximate and isolated), a transferability filter, denominator
   selection, clustering-versus-dividing classification, a four-condition saturation bar, an
   owner-return threshold, and cross-country counting-base rules.

## Vercel plan

The free scan needs 40–90 seconds. **Hobby caps functions at 10 seconds and cannot run it** —
no amount of restructuring changes that. Check Settings → Functions.

## Stripe

The webhook for this section is `/api/businesses/stripe-webhook`. The `/opportunities` webhook
is unchanged and still valid, so existing payments keep working.
