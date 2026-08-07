import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, scanKey, cityCacheKey } from '@/lib/businesses/store';
import { structured, SCAN_MODEL, estimateCostUsd } from '@/lib/businesses/anthropic';
import { SCAN_SYSTEM, scanPrompt } from '@/lib/businesses/prompts';
import { scanSchema } from '@/lib/businesses/schemas';
import { withApi } from '@/lib/businesses/http';
import type { ScanResult } from '@/lib/businesses/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Raise as high as the Vercel plan allows. Hobby caps at 10s and CANNOT complete a scan. */
export const maxDuration = 300;

export const POST = withApi(async (req: NextRequest) => {
  const { id } = await req.json();
  const scan = await kvGet<ScanResult>(scanKey(String(id)));
  if (!scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  if (scan.status !== 'running') return NextResponse.json({ status: scan.status });

  if (!process.env.ANTHROPIC_API_KEY) {
    await kvSet(scanKey(scan.id), { ...scan, status: 'error', error: 'ANTHROPIC_API_KEY is not set on the server.' });
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set on the server.' }, { status: 500 });
  }

  try {
    const { data, usage, searches } = await structured<any>({
      model: SCAN_MODEL,
      system: SCAN_SYSTEM,
      prompt: scanPrompt(scan.city.raw),
      schema: scanSchema as unknown as Record<string, unknown>,
      maxTokens: 12000,
      maxSearches: Number(process.env.MAX_WEB_SEARCHES_FREE || 6),
    });

    const result = {
      ...scan,
      status: 'ready' as const,
      city: {
        raw: scan.city.raw,
        name: data.city?.name ?? scan.city.raw,
        region: data.city?.region ?? '',
        country: data.city?.country ?? '',
        population: data.city?.population,
        slug: scan.city.slug,
      },
      categoriesScreened: data.categoriesScreened ?? 0,
      opportunityCount: data.opportunityCount ?? 0,
      strongCount: data.strongCount ?? 0,
      moderateCount: data.moderateCount ?? 0,
      falsePositiveCount: data.falsePositiveCount ?? 0,
      peerCities: (data.peerCities ?? []).map((p: any) => ({ name: p.name, score: p.score })),
      profileHighlights: data.profileHighlights ?? [],
      teasers: data.teasers ?? [],
      headlineTheme: data.headlineTheme ?? '',
    } as unknown as ScanResult;

    await kvSet(scanKey(scan.id), result);
    await kvSet(cityCacheKey(scan.city.slug), result, 60 * 60 * 24 * 14);
    console.log(`[scan] ${scan.city.slug} searches=${searches} cost=$${estimateCostUsd(SCAN_MODEL, usage).toFixed(3)}`);
    return NextResponse.json({ status: 'ready' });
  } catch (e: any) {
    await kvSet(scanKey(scan.id), { ...scan, status: 'error', error: e?.message ?? 'Scan failed' });
    return NextResponse.json({ error: e?.message ?? 'Scan failed' }, { status: 500 });
  }
});
