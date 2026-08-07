import { notFound } from 'next/navigation';
import Link from 'next/link';
import Unlock from './Unlock';
import Progress from './Progress';
import Disclaimer from '../../Disclaimer';
import { kvGet, scanKey } from '@/lib/businesses/store';
import { GAP_TYPE_LABEL, type ScanResult, type GapType } from '@/lib/businesses/types';

export const dynamic = 'force-dynamic';

const PRICE = (Number(process.env.OPP_PRICE_CENTS || 2999) / 100).toFixed(2);
const CUR = (process.env.OPP_CURRENCY || 'cad').toUpperCase();

type Ctx = { params: { id: string } | Promise<{ id: string }> };

export default async function ScanPage({ params }: Ctx) {
  const { id } = await params;
  const scan = await kvGet<ScanResult>(scanKey(id));
  if (!scan) notFound();

  if (scan.status === 'running') {
    return <Progress id={scan.id} city={scan.city.raw || scan.city.name} />;
  }

  if (scan.status === 'error') {
    return (
      <main className="mx-auto max-w-3xl px-5 py-24">
        <h1 className="text-2xl font-bold text-slate-900">That scan did not complete</h1>
        <p className="mt-3 text-slate-600">{scan.error}</p>
        <Link href="/businesses" className="mt-6 inline-block rounded-lg bg-slate-900 px-5 py-3 text-white">
          Try another city
        </Link>
      </main>
    );
  }

  const label = [scan.city.name, scan.city.region, scan.city.country].filter(Boolean).join(', ');
  const types = (scan.typeBreakdown ?? []).filter(t => t.count > 0);
  const underserved = types.filter(t => t.type !== 'absent').reduce((a, t) => a + t.count, 0);

  return (
    <main className="mx-auto max-w-5xl px-5 py-14">
      <p className="text-sm font-semibold uppercase tracking-widest text-amber-700">Free scan complete</p>
      <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">{label}</h1>
      {scan.city.population ? (
        <p className="mt-2 text-slate-500">Population {scan.city.population.toLocaleString()}</p>
      ) : null}

      <div className="mt-10 grid gap-4 sm:grid-cols-4">
        {([
          [scan.opportunityCount, 'opportunities found', 'scored 55+ and survived the leakage test'],
          [scan.strongCount, 'rated strong', 'scored 70 or above'],
          [underserved, 'underserved, not missing', 'categories that exist and are served badly'],
          [scan.falsePositiveCount, 'rejected', 'looked like gaps and were not'],
        ] as [number, string, string][]).map(([n, t, s]) => (
          <div key={t} className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-4xl font-bold text-slate-900">{n}</p>
            <p className="mt-1 text-sm font-semibold text-slate-700">{t}</p>
            <p className="mt-1 text-xs text-slate-500 leading-snug">{s}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-500">{scan.categoriesScreened} business categories screened across five domains.</p>

      {scan.headlineTheme && (
        <blockquote className="mt-8 rounded-xl border-l-4 border-amber-600 bg-amber-50 p-5 text-slate-800">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Headline theme</span>
          {scan.headlineTheme}
        </blockquote>
      )}

      {types.length > 0 && (
        <section className="mt-14">
          <h2 className="text-xl font-bold text-slate-900">What kind of opportunities they are</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Most analysis stops at &ldquo;absent&rdquo;. The categories below it are where the money usually is —
            businesses that already exist here and are served badly.
          </p>
          <div className="mt-5 space-y-2">
            {types.map(t => {
              const max = Math.max(...types.map(x => x.count));
              return (
                <div key={t.type} className="flex items-center gap-4">
                  <span className="w-44 shrink-0 text-sm text-slate-600">{GAP_TYPE_LABEL[t.type as GapType] ?? t.type}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-slate-100">
                    <div className="h-full rounded bg-slate-800" style={{ width: `${Math.max(6, (t.count / max) * 100)}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">{t.count}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {scan.profileHighlights.length > 0 && (
        <section className="mt-14">
          <h2 className="text-xl font-bold text-slate-900">What we found about {scan.city.name}</h2>
          <dl className="mt-5 grid gap-x-8 gap-y-1 sm:grid-cols-2">
            {scan.profileHighlights.map(p => (
              <div key={p.label} className="flex justify-between gap-4 border-b border-slate-100 py-2">
                <dt className="text-sm text-slate-500">{p.label}</dt>
                <dd className="text-right text-sm font-semibold text-slate-900">{p.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {scan.peerCities.length > 0 && (
        <section className="mt-14">
          <h2 className="text-xl font-bold text-slate-900">Your peer group</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            The municipalities {scan.city.name} was measured against, ranked by weighted similarity.
            Everything in the report is relative to them.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {scan.peerCities.map(p => (
              <span key={p.name} className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-700">
                {p.name} <span className="ml-1.5 tabular-nums text-slate-400">{p.score}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="mt-14">
        <h2 className="text-xl font-bold text-slate-900">Where the opportunities are</h2>
        <div className="mt-5 space-y-3">
          {scan.teasers.map(t => (
            <div key={t.domain} className="rounded-xl border border-slate-200 p-5">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="font-semibold text-slate-900">{t.domain}</h3>
                <div className="flex shrink-0 items-center gap-4 text-sm">
                  <span className="text-slate-500">{t.count} found</span>
                  {t.count > 0 && (
                    <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">best {t.topScore}</span>
                  )}
                </div>
              </div>
              <p className="mt-2 text-sm italic text-slate-500">{t.hint}</p>
              {t.count > 0 && (
                <div className="mt-3 space-y-1.5" aria-hidden>
                  {Array.from({ length: Math.min(t.count, 4) }).map((_, i) => (
                    <div key={i} className="h-4 rounded bg-slate-200 blur-[5px]" style={{ width: `${88 - i * 13}%` }} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <Unlock scanId={scan.id} price={PRICE} currency={CUR} count={scan.opportunityCount} city={scan.city.name} />
      <Disclaimer />
    </main>
  );
}
