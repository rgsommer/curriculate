import CityForm from './CityForm';
import Disclaimer from './Disclaimer';

export const metadata = {
  title: 'Opportunity Gap Analysis — what business is missing from your city',
  description:
    'We screen 200+ business categories against a scored peer group of comparable cities, test what is missing AND what is underserved, and report only what survives — with net income projections.',
};

const PRICE = (Number(process.env.OPP_PRICE_CENTS || 2999) / 100).toFixed(2);
const CUR = (process.env.OPP_CURRENCY || 'cad').toUpperCase();

const GAP_TYPES: [string, string][] = [
  ['Absent', 'Zero local providers, while comparable cities support the category.'],
  ['Undersupplied', 'Present, but materially below the per-capita rate of peer cities.'],
  ['Capacity constrained', 'Present in adequate numbers and rationing access — waitlists, months-long queues, "not accepting new clients". Often the biggest opportunity in a city, and invisible if you only count storefronts.'],
  ['Quality gap', 'Present but weakly executed. Falling ratings, dated premises, every provider a generalist where peers support specialists.'],
  ['Segment gap', 'Present but serving only part of the market — families but not seniors, owners but not condo residents, mid-market with no premium or budget option.'],
  ['Format gap', 'The service exists but not in the shape demand wants. Fixed clinic where demand is mobile. Per-visit where demand is membership. Weekday-only where the customers work weekdays.'],
  ['Exiting', 'Providers closing or retiring without succession. Demand persists while supply actively falls.'],
];

export default function OpportunitiesLanding() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-16">
      <p className="text-sm font-semibold uppercase tracking-widest text-amber-700">Market gap analysis</p>
      <h1 className="mt-4 max-w-3xl text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-tight">
        What business is thriving in cities like yours — and missing or underserved in yours?
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-slate-600 leading-relaxed">
        Not a list of business ideas. We build a scored peer group of comparable municipalities, screen
        200+ business categories against it, run a leakage test against every neighbouring market, and
        report only what survives — each with a bottom-up net income projection. Most ideas do not survive.
      </p>
      <div className="mt-9 max-w-2xl"><CityForm big /></div>
      <p className="mt-4 text-sm text-slate-500">
        The free scan tells you how many real opportunities exist. The full report tells you what they are.
      </p>

      <section className="mt-20">
        <h2 className="text-2xl font-bold text-slate-900">A missing business is the least interesting finding</h2>
        <p className="mt-4 max-w-3xl text-slate-600">
          Anyone can notice that a town has no ramen shop. The money is usually in categories that already
          exist and are served badly — and those are invisible to analysis that only counts storefronts.
          We classify every finding into one of seven types:
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {GAP_TYPES.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-semibold text-slate-900">{t}</h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-2xl font-bold text-slate-900">Why most “market gap” analysis is worthless</h2>
        <p className="mt-4 max-w-3xl text-slate-600">
          It finds absence and calls it opportunity. Four rules do the real work, and they eliminate the
          overwhelming majority of candidates:
        </p>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {[
            ['The leakage test', 'A gap is not a gap if three providers sit ten minutes away in the next town. This single rule kills more candidates than everything else combined — and it is the rule generic AI answers never apply.'],
            ['Physical presence', 'A business advertising in your city is not a business in your city. Home services and trades are saturated with regional operators running city-specific landing pages. Only verified addresses count.'],
            ['Income is not demand', 'A wealthy population is capacity to pay, never evidence anyone wants to buy. Demand has to be evidenced: waitlists, official reports, published capacity shortfalls, observed out-of-town travel.'],
            ['Could the incumbent just fix it?', 'For every quality or capacity gap we ask what stops the existing provider solving the problem the day you open. If the answer is “nothing”, the opportunity is much weaker than it looks — and we say so.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="font-semibold text-slate-900">{t}</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20 rounded-2xl bg-slate-50 border border-slate-200 p-8">
        <h2 className="text-2xl font-bold text-slate-900">Every opportunity comes with the numbers</h2>
        <p className="mt-3 max-w-3xl text-slate-600">
          Each of the top 25 carries a bottom-up projection, not a headline: the volume assumption and
          where it comes from, average transaction value, revenue for years one to three, gross margin,
          itemised fixed costs, <strong>net income for years one, two and three</strong>, months to
          breakeven, and whether that net income is before or after paying you.
        </p>
        <p className="mt-3 max-w-3xl text-slate-600">
          Where a business cannot support a full-time owner&apos;s income, the report says so. That is
          often the most useful sentence in it.
        </p>
      </section>

      <section className="mt-20">
        <h2 className="text-2xl font-bold text-slate-900">What the analysis actually does</h2>
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            ['1. Profile', 'Population, growth, age structure, income, housing mix, immigration, commuting, employment base, retail nodes, planned development and the effect of neighbouring markets.'],
            ['2. Peer group', '15–25 comparable municipalities scored on a transparent weighting: demographics 25%, income 20%, urban form 15%, metro proximity 15%, growth 10%, waterfront 5%, climate 5%, commercial structure 5%.'],
            ['3. Category inventory', '200+ categories across food and retail, health and seniors, trades and home, recreation and circular economy, and professional and B2B services.'],
            ['4. Supply and quality test', 'How many providers exist, per capita, how good they are, which segments and formats they serve, whether they are rationing access — and whether the next town over absorbs your demand.'],
            ['5. Prevalence and gap', 'Share of peers with the category, locations per 100,000, expected local supply at the peer median, actual supply, and the deficiency. Plus: where peers support a specialisation this city does not.'],
            ['6. Reality check', 'Every finalist is attacked: why has nobody done it, is demand weak, is it served next door, can a big-box incumbent crush it, can the existing provider simply fix it, and what evidence would disprove it.'],
          ].map(([t, d]) => (
            <li key={t} className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="font-semibold text-slate-900">{t}</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-20">
        <h2 className="text-2xl font-bold text-slate-900">Pricing</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-8">
            <p className="text-sm font-semibold uppercase tracking-wider text-slate-400">Free scan</p>
            <p className="mt-2 text-4xl font-bold text-slate-900">$0</p>
            <ul className="mt-6 space-y-2.5 text-sm text-slate-600">
              <li>✓ Your city resolved and profiled</li>
              <li>✓ Your scored peer group, named</li>
              <li>✓ How many real opportunities exist</li>
              <li>✓ The split between missing and underserved</li>
              <li>✓ How many were investigated and rejected</li>
              <li className="text-slate-400">✕ What the opportunities are</li>
            </ul>
          </div>
          <div className="relative rounded-2xl border-2 border-slate-900 p-8">
            <span className="absolute -top-3 left-8 rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white">Full report</span>
            <p className="text-sm font-semibold uppercase tracking-wider text-slate-400">One city, one payment</p>
            <p className="mt-2 text-4xl font-bold text-slate-900">${PRICE} <span className="text-base font-normal text-slate-400">{CUR}</span></p>
            <ul className="mt-6 space-y-2.5 text-sm text-slate-600">
              <li>✓ Top 25 opportunities, scored, classified by type</li>
              <li>✓ Net income projection for every one</li>
              <li>✓ Peer group with full similarity scoring</li>
              <li>✓ 20 expansions for existing businesses</li>
              <li>✓ Top 10 low-capital and top 10 scalable lists</li>
              <li>✓ 10 municipal and youth-enterprise opportunities</li>
              <li>✓ 15+ false positives with the reason each failed</li>
              <li>✓ Three launch packages with 90-day validation plans and kill criteria</li>
              <li>✓ Research appendix, sources and limitations</li>
            </ul>
          </div>
        </div>
        <div className="mt-10 max-w-xl"><CityForm /></div>
      </section>

      <Disclaimer />
    </main>
  );
}
