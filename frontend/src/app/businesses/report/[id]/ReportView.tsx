'use client';
import { useEffect, useRef, useState } from 'react';
import { GAP_TYPE_LABEL, type FullReport, type Financials, type GapType } from '@/lib/businesses/types';

const TYPE_STYLE: Record<string, string> = {
  absent: 'bg-slate-900 text-white',
  undersupplied: 'bg-blue-700 text-white',
  capacity_constrained: 'bg-amber-600 text-white',
  quality_gap: 'bg-rose-700 text-white',
  segment_gap: 'bg-violet-700 text-white',
  format_gap: 'bg-teal-700 text-white',
  exiting: 'bg-orange-700 text-white',
};

export default function ReportView({ id }: { id: string }) {
  const [report, setReport] = useState<Partial<FullReport> | null>(null);
  const [err, setErr] = useState('');
  const kicking = useRef(false);

  useEffect(() => {
    let stop = false;
    async function kick() {
      if (kicking.current) return;
      kicking.current = true;
      try {
        await fetch('/api/businesses/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
      } catch {} finally { kicking.current = false; }
    }
    async function tick() {
      try {
        const res = await fetch(`/api/businesses/report/${id}`, { cache: 'no-store' });
        if (res.status === 402) { setErr('This report has not been paid for yet.'); return; }
        if (res.status === 404) { await kick(); if (!stop) setTimeout(tick, 4000); return; }
        const data = (await res.json()) as FullReport;
        if (stop) return;
        setReport(data);
        if (data.status === 'ready') return;
        if (data.status === 'error') { setErr(data.error || 'Generation failed'); return; }
        kick();
        setTimeout(tick, 5000);
      } catch {
        if (!stop) setTimeout(tick, 6000);
      }
    }
    tick();
    return () => { stop = true; };
  }, [id]);

  if (err) return <main className="mx-auto max-w-3xl px-5 py-24"><h1 className="text-2xl font-bold text-slate-900">{err}</h1></main>;
  if (!report) return <Progress phase="Starting" pct={2} />;
  if (report.status !== 'ready') return <Progress phase={report.progress?.phase ?? 'Working'} pct={report.progress?.pct ?? 5} partial={report} />;

  const r = report as FullReport;
  const label = [r.city?.name, r.city?.region].filter(Boolean).join(', ');

  return (
    <main className="mx-auto max-w-4xl px-5 py-12">
      <div className="no-print flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-amber-700">Full report</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">{label}</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Download PDF</button>
          <a href={`/api/businesses/report/${id}`} download={`${r.city?.slug || 'report'}-data.json`} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Download data</a>
        </div>
      </div>

      <Section title="1. Executive summary">
        <Markdownish text={r.executiveSummary} />
        {r.misconceptions?.length > 0 && (<>
          <H3>Misconceptions this study corrected</H3>
          <ul className="list-disc space-y-1 pl-6">{r.misconceptions.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </>)}
      </Section>

      <Section title="2. Peer group">
        <Markdownish text={r.peerMethodology} />
        <Table head={['#','City','Score','Population','Note']}
          rows={(r.peerGroup ?? []).map(p => [String(p.rank), p.city, String(p.score), p.population?.toLocaleString?.() ?? '', p.note])} />
      </Section>

      <Section title="3. Top 25 opportunities">
        {r.opportunities?.map(o => (
          <article key={o.rank} className="mb-8 rounded-xl border border-slate-200 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900">{o.rank}. {o.category}</h3>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${TYPE_STYLE[o.gapType] ?? 'bg-slate-700 text-white'}`}>
                  {GAP_TYPE_LABEL[o.gapType as GapType] ?? o.gapType}
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{o.score}/100 · {o.confidence}</span>
              </div>
            </div>
            <p className="mt-2 text-slate-700">{o.description}</p>
            <FinancialsBlock f={o.financials} />
            <Field k="Evidence for this gap type" v={o.gapEvidence} />
            <Field k="Peer prevalence" v={o.peerPrevalence} />
            <Field k="Peer examples" v={o.peerExamples} />
            <Field k="Local supply" v={o.localSupply} />
            <Field k="Incumbent quality" v={o.incumbentQuality} />
            <Field k="Expected supply" v={o.expectedSupply} />
            <Field k="Leakage test" v={o.leakageTest} />
            <Field k="Demand evidence" v={o.demandEvidence} />
            <Field k="Why nobody has done it" v={o.whyNotAlready} />
            <Field k="Could the incumbent just fix it?" v={o.incumbentResponse} />
            <Field k="Recommended model" v={o.ownershipModel} />
            <Field k="Best operator" v={o.bestOperator} />
            <Field k="Startup cost (estimate)" v={o.startupCost} />
            <Field k="Time to first revenue" v={o.timeToRevenue} />
            <Field k="Staffing" v={o.staffing} />
            <Field k="Revenue model" v={o.revenueModel} />
            <Field k="Recurring potential" v={o.recurringPotential} />
            <Field k="Risks" v={o.risks} />
            <Field k="Reality check" v={o.realityCheck} />
            <Field k="What would disprove it" v={o.disprovingEvidence} />
            {o.sources?.length > 0 && <p className="mt-2 break-all text-xs text-slate-400">Sources: {o.sources.join(' · ')}</p>}
          </article>
        ))}
      </Section>

      <Section title="4. Top 20 complementary expansions">
        {r.expansions?.map((e, i) => (
          <article key={i} className="mb-6 rounded-xl border border-slate-200 p-5">
            <h3 className="text-base font-semibold text-slate-900">{i + 1}. {e.existingBusinessType} → {e.proposedExpansion}</h3>
            <Field k="Estimated incremental net income" v={e.netIncomeEstimate} />
            <Field k="Why it fits" v={e.whyItFits} />
            <Field k="Assets leveraged" v={e.assetsLeveraged} />
            <Field k="Target customer" v={e.targetCustomer} />
            <Field k="Comparable examples" v={e.comparableExamples} />
            <Field k="Capital (estimate)" v={e.capital} />
            <Field k="Difficulty" v={e.difficulty} />
            <Field k="Revenue potential" v={e.revenuePotential} />
            <Field k="Risks" v={e.risks} />
            <Field k="Evidence strength" v={e.evidenceStrength} />
          </article>
        ))}
      </Section>

      <Section title="5. Top 10 low-capital opportunities">
        <Table head={['Opportunity','Score','Capital (est.)','Net income yr 2 (est.)','Cheapest test']}
          rows={(r.lowCapital ?? []).map(x => [x.category, String(x.score), x.capital, x.netIncomeYear2, x.test])} />
      </Section>
      <Section title="6. Top 10 scalable opportunities">
        <Table head={['Opportunity','Score','Scaling path','Main obstacle']}
          rows={(r.scalable ?? []).map(x => [x.category, String(x.score), x.path, x.obstacle])} />
      </Section>
      <Section title="7. Top 10 municipal and youth-enterprise opportunities">
        <Table head={['Opportunity','Sponsor','Capital (est.)','Why it belongs here']}
          rows={(r.municipal ?? []).map(x => [x.title, x.sponsor, x.capital, x.why])} />
      </Section>
      <Section title="8. False positives">
        <p className="text-slate-600">Investigated as genuine candidates and rejected. Often the most valuable section.</p>
        <Table head={['Category','Score','Why it was rejected']}
          rows={(r.falsePositives ?? []).map(x => [x.category, String(x.score), x.rejectionReason])} />
      </Section>

      <Section title="9. Three launch packages">
        {r.concepts?.map((c, i) => (
          <article key={i} className="mb-10 rounded-xl border-2 border-slate-300 p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">
              {c.kind === 'standalone' ? 'Standalone startup' : c.kind === 'augmentation' ? 'Augmentation to an existing business' : 'Municipal / employment / youth enterprise'}
            </p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">{c.title}</h3>
            <p className="mt-1 font-medium text-slate-700">{c.oneLine}</p>
            <FinancialsBlock f={c.financials} />
            {([['Exact target customer', c.targetCustomer],['Problem solved', c.problemSolved],
               ['Local evidence', c.localEvidence],['Comparable-market evidence', c.peerEvidence],
               ['Proposed services', c.services],['Pricing (estimates)', c.pricing],
               ['Revenue streams', c.revenueStreams],['Gross margins (ESTIMATES)', c.grossMargins],
               ['Capital (estimate)', c.capital],['Staffing', c.staffing],['Equipment', c.equipment],
               ['Property', c.property],['Licensing', c.licensing],['Insurance', c.insurance],
               ['Sales strategy', c.salesStrategy],['Marketing channels', c.marketingChannels],
               ['Partnerships', c.partnerships],['First 90 days', c.ninetyDayPlan],
               ['One-year plan', c.oneYearPlan],['Major risks', c.risks],
               ['Kill criteria', c.killCriteria],['Evidence still needed', c.evidenceStillNeeded]] as [string, string][])
              .map(([k, v]) => <Field key={k} k={k} v={v} />)}
          </article>
        ))}
      </Section>

      <Section title="10. Research appendix">
        <Markdownish text={r.appendix?.methodology} />
        <H3>Limitations</H3><ul className="list-disc space-y-1 pl-6">{r.appendix?.limitations?.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <H3>Unresolved questions</H3><ul className="list-disc space-y-1 pl-6">{r.appendix?.unresolvedQuestions?.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <H3>Recommended next steps</H3><ul className="list-disc space-y-1 pl-6">{r.appendix?.nextSteps?.map((x, i) => <li key={i}>{x}</li>)}</ul>
        {r.appendix?.sources?.length ? (<><H3>Sources</H3><ul className="list-disc space-y-1 break-all pl-6 text-sm">{r.appendix.sources.map((x, i) => <li key={i}>{x}</li>)}</ul></>) : null}
      </Section>

      <p className="no-print mt-16 max-w-3xl text-sm text-slate-500">
        <strong className="text-slate-700">All financial figures are estimates.</strong> Net income
        projections are built from the stated assumptions, not from any operating business&apos;s books.
        Provider counts are directory-derived lower bounds. This is research, not investment advice.
      </p>
    </main>
  );
}

function FinancialsBlock({ f }: { f?: Financials }) {
  if (!f) return null;
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Net income projection — estimate, before owner&apos;s salary unless noted
      </p>
      <div className="grid grid-cols-3 gap-3 text-center">
        {([['Year 1', f.netIncomeYear1], ['Year 2', f.netIncomeYear2], ['Year 3', f.netIncomeYear3]] as [string, string][]).map(([y, v]) => (
          <div key={y} className="rounded border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">{y}</p>
            <p className="mt-1 text-sm font-bold text-slate-900">{v}</p>
          </div>
        ))}
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <Row k="Volume assumption" v={f.volumeDriver} />
        <Row k="Basis for that volume" v={f.volumeBasis} />
        <Row k="Average transaction" v={f.averageTransaction} />
        <Row k="Revenue yr 1 / 2 / 3" v={[f.revenueYear1, f.revenueYear2, f.revenueYear3].filter(Boolean).join('  ·  ')} />
        <Row k="Gross margin" v={f.grossMarginPct} />
        <Row k="Fixed costs" v={f.fixedCosts} />
        <Row k="Breakeven" v={f.breakevenMonths} />
        <Row k="Owner's pay" v={f.ownerSalaryTreatment} />
        <Row k="Most sensitive to" v={f.sensitivities} />
      </dl>
    </div>
  );
}
function Row({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return <div className="flex gap-2"><dt className="shrink-0 font-semibold text-slate-600">{k}:</dt><dd className="text-slate-700">{v}</dd></div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="mb-3 border-b border-slate-200 pb-2 text-xl font-bold text-slate-900">{title}</h2>
      <div className="space-y-2 text-slate-700">{children}</div>
    </section>
  );
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 mb-2 text-base font-semibold text-slate-800">{children}</h3>;
}
function Field({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return <p className="my-2 text-sm"><span className="font-semibold text-slate-800">{k}. </span><span className="text-slate-600">{v}</span></p>;
}
function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="bg-slate-900 text-left text-white">{head.map(h => <th key={h} className="p-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => (
          <tr key={i} className="border-b border-slate-100 align-top">{row.map((c, j) => <td key={j} className="p-2 text-slate-700">{c}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}
function Markdownish({ text }: { text?: string }) {
  if (!text) return null;
  return <>{text.split(/\n{2,}/).map((p, i) =>
    p.startsWith('## ') ? <H3 key={i}>{p.slice(3)}</H3> : <p key={i} className="my-3 leading-relaxed">{p.replace(/^#+\s*/, '')}</p>)}</>;
}
function Progress({ phase, pct, partial }: { phase: string; pct: number; partial?: Partial<FullReport> }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-24">
      <h1 className="text-2xl font-bold text-slate-900">Building your report</h1>
      <p className="mt-3 text-slate-600">{phase}…</p>
      <div className="mt-6 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-slate-900 transition-all duration-700" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
      <p className="mt-6 text-sm text-slate-500">
        This is real research — searching sources, building the peer group, testing every candidate
        against neighbouring markets and modelling the numbers. It takes several minutes. You can close
        this tab; we email the link when it is ready.
      </p>
      {partial?.peerGroup?.length ? (
        <p className="mt-6 text-sm text-slate-400">Peer group settled: {partial.peerGroup.slice(0, 6).map(p => p.city).join(', ')}…</p>
      ) : null}
    </main>
  );
}
