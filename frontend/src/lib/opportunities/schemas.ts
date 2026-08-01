const S = (description: string) => ({ type: 'string', description });
const arr = (items: unknown, description: string) => ({ type: 'array', description, items });

const GAP_TYPE = {
  type: 'string',
  enum: ['absent','undersupplied','capacity_constrained','quality_gap','segment_gap','format_gap','exiting'],
  description: 'Which of the seven opportunity types this is. Be precise — the evidence bar, the competitive risk and the go-to-market all differ by type.',
};

const FINANCIALS = {
  type: 'object',
  required: ['volumeDriver','volumeBasis','averageTransaction','revenueYear1','revenueYear2','revenueYear3','grossMarginPct','fixedCosts','netIncomeYear1','netIncomeYear2','netIncomeYear3','breakevenMonths','ownerSalaryTreatment','sensitivities'],
  description: 'Bottom-up net income projection. ALL FIGURES ARE ESTIMATES. Be realistic rather than flattering — many of these lose money in year 1 and the projection must show it.',
  properties: {
    volumeDriver: S('The volume assumption, e.g. "14 jobs per month by month 12, 22 by year 3"'),
    volumeBasis: S('Where that number comes from. If it is a judgement call, say so.'),
    averageTransaction: S('Average job value, ticket or monthly fee, with currency'),
    revenueYear1: S('Annual revenue, year 1, with currency'),
    revenueYear2: S('Annual revenue, year 2'),
    revenueYear3: S('Annual revenue, year 3'),
    grossMarginPct: S('Gross margin percentage and what is inside cost of delivery'),
    fixedCosts: S('Annual fixed costs itemised at least to rent, labour, insurance, vehicle, marketing, software'),
    netIncomeYear1: S('NET INCOME year 1 — negative if that is the honest answer'),
    netIncomeYear2: S('Net income year 2'),
    netIncomeYear3: S('Net income year 3'),
    breakevenMonths: S('Months to monthly breakeven, and to recovering the startup capital'),
    ownerSalaryTreatment: S('State plainly whether net income is BEFORE or AFTER the owner is paid, and whether this can support a full-time owner income at all'),
    sensitivities: S('The three assumptions the projection is most sensitive to, and what happens if each is 30% worse'),
  },
};

export const scanSchema = {
  type: 'object',
  required: ['city','categoriesScreened','opportunityCount','strongCount','moderateCount','falsePositiveCount','typeBreakdown','peerCities','profileHighlights','teasers','headlineTheme'],
  properties: {
    city: {
      type: 'object', required: ['name','region','country'],
      properties: {
        name: S('Resolved municipality name'), region: S('Province or state'),
        country: S('Country'), population: { type: 'number', description: 'Most recent official population' },
      },
    },
    categoriesScreened: { type: 'number', description: 'How many categories you actually screened. Be honest.' },
    opportunityCount: { type: 'number', description: 'Candidates that survived the leakage test and scored 55+' },
    strongCount: { type: 'number', description: 'Candidates scoring 70+' },
    moderateCount: { type: 'number', description: 'Candidates scoring 55-69' },
    falsePositiveCount: { type: 'number', description: 'Candidates investigated and rejected' },
    typeBreakdown: arr({
      type: 'object', required: ['type','count'],
      properties: { type: GAP_TYPE, count: { type: 'number' } },
    }, 'Count of surviving opportunities by type. Include types with a zero count. This is the headline proof that the analysis looks beyond missing businesses.'),
    peerCities: arr({
      type: 'object', required: ['name','score','note'],
      properties: { name: S('City, region'), score: { type: 'number' }, note: S('One clause on why it is comparable') },
    }, '8-12 peer municipalities ranked by similarity, highest first'),
    profileHighlights: arr({
      type: 'object', required: ['label','value'],
      properties: { label: S('Indicator'), value: S('Value with units') },
    }, '6-10 defining facts: population, growth, median age, senior share, median household income, homeownership, dwelling mix, commuting, nearest metros and drive times'),
    teasers: arr({
      type: 'object', required: ['domain','count','topScore','hint'],
      properties: {
        domain: S('One of: Food, retail and culture / Health, seniors and family / Trades, home and automotive / Recreation, seasonal and circular / Professional, B2B and technology'),
        count: { type: 'number' }, topScore: { type: 'number' },
        hint: S('DELIBERATELY NON-ACTIONABLE. Describe the shape of the finding, never the business type, customer or model.'),
      },
    }, 'One entry per domain, including domains with a zero count'),
    headlineTheme: S('One sentence describing the structural pattern behind the findings, naming no specific business'),
    leakageNote: S('Which neighbouring municipalities were treated as leakage risks and roughly how many candidates they eliminated'),
  },
} as const;

export const profileSchema = {
  type: 'object',
  required: ['executiveSummary','misconceptions','peerGroup','peerMethodology'],
  properties: {
    executiveSummary: S('600-900 words of markdown. Lead with the single strongest structural finding, then the most credible opportunities by type, then the largest misconceptions this study corrected. Say explicitly how much of the value sits in underserved categories rather than absent ones.'),
    misconceptions: arr(S('One misconception, stated and then corrected with evidence'), '3-6 widely-held but wrong assumptions about this city\'s market'),
    peerGroup: arr({
      type: 'object', required: ['rank','city','score','population','note'],
      properties: {
        rank: { type: 'number' }, city: S('City, region'), score: { type: 'number' },
        population: { type: 'number' }, medianAge: { type: 'number' },
        medianIncome: S('With currency'), note: S('Why comparable and where it differs'),
      },
    }, '15-25 peer municipalities ranked by similarity'),
    peerMethodology: S('Markdown: the weighting used, screens applied, and what was deliberately excluded and why'),
  },
} as const;

export const opportunitiesSchema = {
  type: 'object',
  required: ['opportunities'],
  properties: {
    opportunities: arr({
      type: 'object',
      required: ['rank','category','description','gapType','gapEvidence','score','confidence','financials'],
      properties: {
        rank: { type: 'number' },
        category: S('Business category'),
        description: S('What the business actually is, in plain language'),
        gapType: GAP_TYPE,
        gapEvidence: S('The specific evidence for THIS gap type. For capacity, quality, segment and format gaps the bar is higher: cite ratings, review volume, published wait times, capacity statements or repeated specific complaints. Never assert a quality gap from impression.'),
        score: { type: 'number', description: '0-100 on the stated model' },
        confidence: { type: 'string', enum: ['high','medium','low'] },
        peerPrevalence: S('Share of peers with the category and the per-100k rate'),
        peerExamples: S('Named comparable operators or cities. Verified only.'),
        localSupply: S('What exists locally today and how you counted it'),
        incumbentQuality: S('How good the existing providers are: ratings, review volume, longevity, specialisation, formats offered, segments served. Say "not assessable" if you could not obtain it.'),
        expectedSupply: S('Expected count at the peer median rate and the resulting gap'),
        leakageTest: S('Explicit result of the 10-20 minute leakage test applied to the SPECIFIC deficiency, naming nearby providers'),
        demandEvidence: S('Citable local demand signals'),
        whyNotAlready: S('The real reason nobody has done this'),
        incumbentResponse: S('What stops the existing providers simply fixing this the moment you enter? If the answer is "nothing", say so — it materially weakens the opportunity.'),
        ownershipModel: S('Recommended structure'),
        bestOperator: S('Who is structurally best positioned to build it'),
        startupCost: S('Estimated range, labelled an estimate'),
        timeToRevenue: S('Estimate'),
        staffing: S('Estimate'),
        revenueModel: S('How it makes money'),
        recurringPotential: S('Share of revenue that could recur'),
        financials: FINANCIALS,
        risks: S('Top three risks'),
        realityCheck: S('Verdict of the adversarial review'),
        disprovingEvidence: S('What specific evidence would kill this'),
        sources: arr(S('URL'), 'Source URLs supporting this entry'),
      },
    }, 'The top 25 opportunities ranked by score, highest first. Every one must have survived the reality check and every one must carry a bottom-up net income projection. A good report contains a MIX of types — if all 25 are "absent" you have not looked hard enough at what is present but poorly served.'),
  },
} as const;

export const supportingSchema = {
  type: 'object',
  required: ['expansions','lowCapital','scalable','municipal','falsePositives'],
  properties: {
    expansions: arr({
      type: 'object',
      required: ['existingBusinessType','proposedExpansion','whyItFits','capital','difficulty','netIncomeEstimate'],
      properties: {
        existingBusinessType: S('Business CATEGORY, never a named firm'),
        proposedExpansion: S('The adjacent revenue line'),
        whyItFits: S('Why here specifically'),
        assetsLeveraged: S('What the business already owns that this uses'),
        targetCustomer: S(''),
        comparableExamples: S('Verified examples, or an explicit statement that evidence is weak'),
        capital: S('Estimated range'),
        difficulty: S('low / medium / high'),
        revenuePotential: S('Estimated incremental annual revenue'),
        netIncomeEstimate: S('Estimated incremental ANNUAL NET INCOME once established, and the year it is reached. State the volume assumption behind it.'),
        risks: S(''),
        evidenceStrength: S('strong / medium-high / medium / weak'),
      },
    }, 'Top 20 complementary expansions'),
    lowCapital: arr({
      type: 'object', required: ['category','score','capital','netIncomeYear2','test'],
      properties: {
        category: S(''), score: { type: 'number' }, capital: S('Estimate'),
        netIncomeYear2: S('Estimated net income in year 2, before owner salary'),
        test: S('The cheapest test that would prove or kill it'),
      },
    }, 'Top 10 opportunities testable for under about 25,000 in local currency'),
    scalable: arr({
      type: 'object', required: ['category','score','path','obstacle'],
      properties: { category: S(''), score: { type: 'number' }, path: S('How it scales beyond this city'), obstacle: S('Main barrier to scaling') },
    }, 'Top 10 scalable opportunities'),
    municipal: arr({
      type: 'object', required: ['title','sponsor','capital','why'],
      properties: { title: S(''), sponsor: S('Who should sponsor it'), capital: S('Estimate'), why: S('Why this belongs in the public or non-profit sector rather than being a business') },
    }, 'Top 10 municipal, workforce or youth-enterprise opportunities'),
    falsePositives: arr({
      type: 'object', required: ['category','score','rejectionReason'],
      properties: { category: S(''), score: { type: 'number' }, rejectionReason: S('Specific and evidenced. This is often the most valuable section of the report.') },
    }, 'At least 15 ideas that look like opportunities here and are not. Include at least three that look like QUALITY or CAPACITY gaps and fail — for example where the incumbent could fix the problem trivially, or where the waitlist reflects a labour shortage you would also face.'),
  },
} as const;

export const conceptsSchema = {
  type: 'object',
  required: ['concepts','appendix'],
  properties: {
    concepts: arr({
      type: 'object',
      required: ['title','kind','oneLine','targetCustomer','problemSolved','capital','financials','ninetyDayPlan','killCriteria'],
      properties: {
        title: S(''), kind: { type: 'string', enum: ['standalone','augmentation','municipal'] },
        oneLine: S(''), targetCustomer: S('Exact, not "everyone"'), problemSolved: S(''),
        localEvidence: S('With sources'), peerEvidence: S('With sources'),
        services: S(''), pricing: S('Indicative, labelled as estimates'),
        revenueStreams: S(''), grossMargins: S('CLEARLY MARKED AS ESTIMATES'),
        financials: FINANCIALS,
        capital: S('Estimate'), staffing: S(''), equipment: S(''), property: S(''),
        licensing: S(''), insurance: S(''), salesStrategy: S(''), marketingChannels: S(''),
        partnerships: S(''), ninetyDayPlan: S('Weeks, actions and pass conditions'),
        oneYearPlan: S('Quarter by quarter with targets'), risks: S('Ranked'),
        killCriteria: S('Specific thresholds at which the founder should stop'),
        evidenceStillNeeded: S(''),
      },
    }, 'Exactly three: one standalone startup, one augmentation to an existing business, one suitable for a municipal, employment or youth-entrepreneurship programme'),
    appendix: {
      type: 'object',
      required: ['methodology','limitations','unresolvedQuestions','nextSteps'],
      properties: {
        methodology: S('Markdown: search methodology, sources, how counts and quality assessments were built'),
        limitations: arr(S(''), 'Honest data-quality concerns. Be specific about what you could not verify — especially incumbent quality, which is the hardest thing to measure remotely.'),
        unresolvedQuestions: arr(S(''), 'Open questions that would change conclusions'),
        nextSteps: arr(S(''), 'Recommended primary research'),
        sources: arr(S('URL'), 'Major sources used'),
      },
    },
  },
} as const;
