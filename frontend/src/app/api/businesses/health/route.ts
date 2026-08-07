import { NextResponse } from 'next/server';
import { withApi } from '@/lib/businesses/http';
import { storageHealth, storageBackend } from '@/lib/businesses/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Diagnostics. Reports which configuration is PRESENT — never its value.
 * Open this first whenever anything misbehaves: /api/businesses/health
 */
export const GET = withApi(async () => {
  const has = (k: string) => Boolean(process.env[k] && String(process.env[k]).trim());

  const env = {
    ANTHROPIC_API_KEY: has('ANTHROPIC_API_KEY'),
    STRIPE_SECRET_KEY: has('STRIPE_SECRET_KEY'),
    STRIPE_WEBHOOK_SECRET: has('STRIPE_WEBHOOK_SECRET'),
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || null,
    SUPABASE_URL: has('NEXT_PUBLIC_SUPABASE_URL') || has('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: has('SUPABASE_SERVICE_ROLE_KEY'),
    UPSTASH_REDIS_REST_URL: has('UPSTASH_REDIS_REST_URL'),
    RESEND_API_KEY: has('RESEND_API_KEY'),
  };

  const storage = await storageHealth();
  const problems: string[] = [];

  if (!env.ANTHROPIC_API_KEY) problems.push('ANTHROPIC_API_KEY is not set — scans cannot run.');
  if (!storage.ok) problems.push(`Storage round-trip FAILED (${storage.backend}): ${storage.error}${storage.detail ? ' — ' + storage.detail : ''}`);
  if (storageBackend() === 'disk') problems.push('Storage is falling back to local disk, which is ephemeral on Vercel. Set Supabase or Upstash credentials.');
  if (!env.STRIPE_SECRET_KEY) problems.push('STRIPE_SECRET_KEY is not set — checkout will fail.');
  if (!env.STRIPE_WEBHOOK_SECRET) problems.push('STRIPE_WEBHOOK_SECRET is not set — payments will never be confirmed.');
  if (!env.NEXT_PUBLIC_SITE_URL) problems.push('NEXT_PUBLIC_SITE_URL is not set — Stripe return URLs will be wrong.');

  return NextResponse.json({
    healthy: problems.length === 0,
    problems,
    env,
    storage,
    runtime: { node: process.version, vercel: Boolean(process.env.VERCEL), env: process.env.VERCEL_ENV || 'local' },
    note: 'Booleans only — no secret values are returned by this endpoint.',
  }, { status: problems.length ? 503 : 200 });
});
