import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, reportKey, scanKey, orderKey } from '@/lib/opportunities/store';
import { structured, REPORT_MODEL, estimateCostUsd } from '@/lib/opportunities/anthropic';
import { REPORT_SYSTEM, reportPrompt } from '@/lib/opportunities/prompts';
import { profileSchema, opportunitiesSchema, supportingSchema, conceptsSchema } from '@/lib/opportunities/schemas';
import { siteUrl } from '@/lib/opportunities/stripe';
import { sendReportReady } from '@/lib/opportunities/email';
import type { FullReport, ScanResult, Order } from '@/lib/opportunities/types';

export const runtime = 'nodejs';
/** Each call advances exactly ONE phase, so this works whether your function limit is
 *  60 seconds or 800. The report page polls and re-triggers. */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const PHASES = [
  { key: 'profile',       label: 'Profiling the city and building the peer group', pct: 25 },
  { key: 'opportunities', label: 'Auditing categories, testing supply and quality, scoring the top 25', pct: 55 },
  { key: 'supporting',    label: 'Expansions, low-capital, scalable, municipal, false positives', pct: 80 },
  { key: 'concepts',      label: 'Building three launch packages and the appendix', pct: 100 },
] as const;

function scanContext(scan: ScanResult) {
  return [
    `City: ${scan.city.name}, ${scan.city.region}, ${scan.city.country}` +
      (scan.city.population ? ` (population ${scan.city.population.toLocaleString()})` : ''),
    `Preliminary scan screened ${scan.categoriesScreened} categories and found ${scan.opportunityCount} candidates scoring 55+, of which ${scan.strongCount} scored 70+. It rejected ${scan.falsePositiveCount}.`,
    `By opportunity type: ${(scan.typeBreakdown ?? []).map(t => `${t.type} = ${t.count}`).join(', ')}`,
    `Headline theme: ${scan.headlineTheme}`,
    `Profile highlights: ${scan.profileHighlights.map(p => `${p.label}: ${p.value}`).join('; ')}`,
    `Preliminary peers: ${scan.peerCities.map(p => `${p.name} (${p.score})`).join(', ')}`,
    `Domain counts: ${scan.teasers.map(t => `${t.domain} = ${t.count} (best ${t.topScore})`).join('; ')}`,
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const { id } = await req.json();
  const reportId = String(id);

  const order = await kvGet<Order>(orderKey(reportId));
  const comp = (process.env.OPP_COMP_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  const isComped = Boolean(order?.email && comp.includes(order.email));
  if (!order?.paid && !isComped) return NextResponse.json({ error: 'Payment required' }, { status: 402 });

  const scan = await kvGet<ScanResult>(scanKey(reportId));
  if (!scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });

  const report = (await kvGet<FullReport>(reportKey(reportId))) ?? ({
    id: reportId, city: scan.city, createdAt: Date.now(),
    status: 'queued', progress: { phase: 'Queued', pct: 0 },
  } as FullReport);

  if (report.status === 'ready') return NextResponse.json({ status: 'ready', progress: report.progress });

  const done = {
    profile: Boolean(report.peerGroup?.length),
    opportunities: Boolean(report.opportunities?.length),
    supporting: Boolean(report.falsePositives?.length),
    concepts: Boolean(report.concepts?.length),
  };
  const next = PHASES.find(p => !done[p.key as keyof typeof done]);
  if (!next) {
    report.status = 'ready';
    report.progress = { phase: 'Complete', pct: 100 };
    await kvSet(reportKey(reportId), report);
    return NextResponse.json({ status: 'ready', progress: report.progress });
  }

  report.status = 'running';
  report.progress = { phase: next.label, pct: Math.max(report.progress?.pct ?? 0, next.pct - 20) };
  await kvSet(reportKey(reportId), report);

  const base = reportPrompt(scan.city.raw, scanContext(scan));
  const maxSearches = Number(process.env.OPP_MAX_SEARCHES_PAID || 60);

  try {
    let usage = { input: 0, output: 0 };

    if (next.key === 'profile') {
      const r = await structured<any>({
        model: REPORT_MODEL, system: REPORT_SYSTEM,
        prompt: `${base}\n\n---\nRIGHT NOW complete PHASE 1 and PHASE 2 ONLY: the city profile written up as the executive summary and misconceptions, plus the ranked peer group and the peer methodology. Research properly before answering.`,
        schema: profileSchema as unknown as Record<string, unknown>,
        maxTokens: 20000, maxSearches: Math.round(maxSearches * 0.3),
      });
      Object.assign(report, r.data); usage = r.usage;

    } else if (next.key === 'opportunities') {
      const r = await structured<any>({
        model: REPORT_MODEL, system: REPORT_SYSTEM,
        prompt: `${base}\n\n---\nThe peer group is settled:\n${(report.peerGroup ?? []).map(p => `${p.rank}. ${p.city} (${p.score})`).join('\n')}\n\nRIGHT NOW complete PHASES 3 to 6 and 9 to 10, and return ONLY the ranked top 25 opportunities.\n\nThree things this phase lives or dies on:\n1. Classify every opportunity by type. Look as hard at what is PRESENT BUT POORLY SERVED — capacity-constrained, quality, segment and format gaps — as at what is missing. A list of 25 absent businesses means you did not do this phase properly.\n2. Apply the leakage test to the specific deficiency and print the result.\n3. Every opportunity carries a bottom-up net income projection: volume x price, cost of delivery, itemised fixed costs, net income for years 1, 2 and 3 before owner's salary, and months to breakeven. Be realistic. If it loses money in year 1, show that. If it cannot support a full-time owner, say so.\n\nAnything failing the reality check must be dropped, not softened.`,
        schema: opportunitiesSchema as unknown as Record<string, unknown>,
        maxTokens: 40000, maxSearches: Math.round(maxSearches * 0.45),
      });
      report.opportunities = r.data.opportunities ?? []; usage = r.usage;

    } else if (next.key === 'supporting') {
      const r = await structured<any>({
        model: REPORT_MODEL, system: REPORT_SYSTEM,
        prompt: `${base}\n\n---\nThe top 25 are settled:\n${(report.opportunities ?? []).map(o => `${o.rank}. ${o.category} (${o.score}, ${o.gapType})`).join('\n')}\n\nRIGHT NOW produce PHASES 7 and 8 and the supporting lists: top 20 complementary expansions (each with an estimated incremental annual net income), top 10 low-capital opportunities (each with an estimated year-2 net income), top 10 scalable opportunities, top 10 municipal or youth-enterprise opportunities, and at least 15 false positives with specific evidenced reasons — including at least three that look like quality or capacity gaps and fail.`,
        schema: supportingSchema as unknown as Record<string, unknown>,
        maxTokens: 28000, maxSearches: Math.round(maxSearches * 0.15),
      });
      Object.assign(report, r.data); usage = r.usage;

    } else {
      const top = (report.opportunities ?? []).slice(0, 8)
        .map(o => `${o.rank}. ${o.category} (${o.score}, ${o.gapType}) — ${o.ownershipModel}`).join('\n');
      const exp = (report.expansions ?? []).slice(0, 8)
        .map(e => `${e.existingBusinessType} → ${e.proposedExpansion}`).join('\n');
      const mun = (report.municipal ?? []).slice(0, 5).map(m => `${m.title} (${m.sponsor})`).join('\n');
      const r = await structured<any>({
        model: REPORT_MODEL, system: REPORT_SYSTEM,
        prompt: `${base}\n\n---\nTop opportunities:\n${top}\n\nExpansions:\n${exp}\n\nMunicipal candidates:\n${mun}\n\nRIGHT NOW build the three fully buttoned-up launch concepts (one standalone startup, one augmentation to an existing business, one municipal / employment / youth-enterprise) and the research appendix. Each concept needs pricing, a full bottom-up net income projection for years 1 to 3, margins clearly marked as estimates, a 90-day validation plan with pass conditions, a one-year plan, ranked risks and specific kill criteria.`,
        schema: conceptsSchema as unknown as Record<string, unknown>,
        maxTokens: 40000, maxSearches: Math.round(maxSearches * 0.1),
      });
      Object.assign(report, r.data); usage = r.usage;
      report.status = 'ready';
    }

    report.progress = { phase: next.key === 'concepts' ? 'Complete' : next.label, pct: next.pct };
    await kvSet(reportKey(reportId), report);

    if (report.status === 'ready' && order?.email && !order.notified) {
      order.notified = true;
      await kvSet(orderKey(reportId), order);
      const label = [scan.city.name, scan.city.region].filter(Boolean).join(', ');
      await sendReportReady(order.email, label, `${siteUrl()}/opportunities/report/${reportId}`);
    }

    console.log(`[opp:generate:${next.key}] ${scan.city.slug} cost=$${estimateCostUsd(REPORT_MODEL, usage).toFixed(2)}`);
    return NextResponse.json({ status: report.status, progress: report.progress });
  } catch (e: any) {
    report.status = 'error';
    report.error = e?.message ?? 'Generation failed';
    await kvSet(reportKey(reportId), report);
    return NextResponse.json({ error: report.error }, { status: 500 });
  }
}
