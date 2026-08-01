import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { kvGet, kvSet, scanKey, cityCacheKey } from '@/lib/opportunities/store';
import { structured, SCAN_MODEL, estimateCostUsd } from '@/lib/opportunities/anthropic';
import { SCAN_SYSTEM, scanPrompt } from '@/lib/opportunities/prompts';
import { scanSchema } from '@/lib/opportunities/schemas';
import { rateLimit, clientIp } from '@/lib/opportunities/ratelimit';
import type { ScanResult } from '@/lib/opportunities/types';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function POST(req: NextRequest) {
  let city = '';
  try { city = String((await req.json()).city ?? '').trim(); } catch {}
  if (!city || city.length < 2 || city.length > 120) {
    return NextResponse.json({ error: 'Enter a city name.' }, { status: 400 });
  }

  const slug = slugify(city);
  const id = randomUUID();

  // Cached cities cost nothing to serve, so only rate-limit scans that would actually spend money.
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
    const copy: ScanResult = { ...cached, id, createdAt: Date.now() };
    await kvSet(scanKey(id), copy);
    return NextResponse.json({ id, status: 'ready' });
  }

  const pending: ScanResult = {
    id, createdAt: Date.now(), status: 'running',
    city: { raw: city, name: city, region: '', country: '', slug },
    categoriesScreened: 0, opportunityCount: 0, strongCount: 0, moderateCount: 0,
    falsePositiveCount: 0, typeBreakdown: [], peerCities: [], profileHighlights: [],
    teasers: [], headlineTheme: '',
  };
  await kvSet(scanKey(id), pending);

  try {
    const { data, usage, searches } = await structured<any>({
      model: SCAN_MODEL,
      system: SCAN_SYSTEM,
      prompt: scanPrompt(city),
      schema: scanSchema as unknown as Record<string, unknown>,
      maxTokens: 12000,
      maxSearches: Number(process.env.OPP_MAX_SEARCHES_FREE || 6),
    });

    const result: ScanResult = {
      ...pending,
      status: 'ready',
      city: {
        raw: city, slug,
        name: data.city?.name ?? city,
        region: data.city?.region ?? '',
        country: data.city?.country ?? '',
        population: data.city?.population,
      },
      categoriesScreened: data.categoriesScreened ?? 0,
      opportunityCount: data.opportunityCount ?? 0,
      strongCount: data.strongCount ?? 0,
      moderateCount: data.moderateCount ?? 0,
      falsePositiveCount: data.falsePositiveCount ?? 0,
      typeBreakdown: data.typeBreakdown ?? [],
      peerCities: (data.peerCities ?? []).map((p: any) => ({ name: p.name, score: p.score })),
      profileHighlights: data.profileHighlights ?? [],
      teasers: data.teasers ?? [],
      headlineTheme: data.headlineTheme ?? '',
    };
    await kvSet(scanKey(id), result);
    await kvSet(cityCacheKey(slug), result, 60 * 60 * 24 * 14);
    console.log(`[opp:scan] ${slug} searches=${searches} cost=$${estimateCostUsd(SCAN_MODEL, usage).toFixed(3)}`);
    return NextResponse.json({ id, status: 'ready' });
  } catch (e: any) {
    const failed: ScanResult = { ...pending, status: 'error', error: e?.message ?? 'Scan failed' };
    await kvSet(scanKey(id), failed);
    return NextResponse.json({ id, status: 'error', error: failed.error }, { status: 500 });
  }
}
