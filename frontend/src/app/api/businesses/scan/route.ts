import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { kvGet, kvSet, scanKey, cityCacheKey } from '@/lib/businesses/store';
import { rateLimit, clientIp } from '@/lib/businesses/ratelimit';
import { withApi } from '@/lib/businesses/http';
import type { ScanResult } from '@/lib/businesses/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Creates the scan and RETURNS IMMEDIATELY. The model work happens in /scan-run,
 * driven by the scan page's poller.
 *
 * The previous version ran the whole 40-90 second analysis inline, which exceeds the
 * serverless time limit and kills the connection mid-flight — the direct cause of
 * "Failed to fetch" in the browser.
 */
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const POST = withApi(async (req: NextRequest) => {
  let city = '';
  try { city = String((await req.json()).city ?? '').trim(); } catch {}
  if (!city || city.length < 2 || city.length > 120) {
    return NextResponse.json({ error: 'Enter a city name.' }, { status: 400 });
  }

  const slug = slugify(city);
  const id = randomUUID();

  const cached = await kvGet<ScanResult>(cityCacheKey(slug));
  if (!cached) {
    const rl = await rateLimit(`scan:${clientIp(req)}`, 5, 3600);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'You have run several scans in the last hour. Try again shortly, or buy a report to keep going.' },
        { status: 429 },
      );
    }
  }

  if (cached && cached.status === 'ready') {
    await kvSet(scanKey(id), { ...cached, id, createdAt: Date.now() });
    return NextResponse.json({ id, status: 'ready' });
  }

  await kvSet(scanKey(id), {
    id, createdAt: Date.now(), status: 'running',
    city: { raw: city, name: city, region: '', country: '', slug },
    categoriesScreened: 0, opportunityCount: 0, strongCount: 0, moderateCount: 0,
    falsePositiveCount: 0, peerCities: [], profileHighlights: [], teasers: [], headlineTheme: '',
  } as unknown as ScanResult);

  return NextResponse.json({ id, status: 'running' }, { status: 202 });
});
