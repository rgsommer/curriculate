const S = (description: string) => ({ type: 'string', description });
const arr = (items: unknown, description: string) => ({ type: 'array', description, items });

export const scanSchema = {
  type: 'object',
  required: ['city','categoriesScreened','opportunityCount','strongCount','moderateCount','falsePositiveCount','peerCities','profileHighlights','teasers','headlineTheme'],
  properties: {
    city: {
      type: 'object',
      required: ['name','region','country'],
      properties: {
        name: S('Resolved municipality name'),
        region: S('Province or state'),
        country: S('Country'),
        population: { type: 'number', description: 'Most recent official population' },
      },
    },
    categoriesScreened: { type: 'number', description: 'How many business categories you actually screened. Be honest.' },
    opportunityCount: { type: 'number', description: 'Total candidates that survived the leakage test and scored 55+' },
    strongCount: { type: 'number', description: 'Candidates scoring 70+' },
    moderateCount: { type: 'number', description: 'Candidates scoring 55-69' },
    falsePositiveCount: { type: 'number', description: 'Candidates investigated and rejected' },
    peerCities: arr({
      type: 'object', required: ['name','score','note'],
      properties: { name: S('City, region'), score: { type: 'number', description: '0-100 similarity' }, note: S('One short clause on why it is comparable') },
    }, '8-12 peer municipalities, ranked by similarity score, highest first'),
    profileHighlights: arr({
      type: 'object', required: ['label','value'],
      properties: { label: S('Indicator'), value: S('Value with units') },
    }, '6-10 defining facts about the city: population, growth, median age, senior share, median household income, homeownership, dwelling mix, commuting, nearest metros and drive times'),
    teasers: arr({
      type: 'object', required: ['domain','count','topScore','hint'],
      properties: {
        domain: S('One of: Food, retail and culture / Health, seniors and family / Trades, home and automotive / Recreation, seasonal and circular / Professional, B2B and technology'),
        count: { type: 'number' },
        topScore: { type: 'number' },
        hint: S('DELIBERATELY NON-ACTIONABLE. Describe the shape of the finding, never the business type, customer or model.'),
      },
    }, 'One entry per domain, including domains where the count is zero'),
    headlineTheme: S('One sentence describing the structural pattern behind the findings, naming no specific business'),
    leakageNote: S('Which neighbouring municipalities were treated as leakage risks, and roughly how many candidates they eliminated'),
  },
} as const;

export const profileSchema = {
  type: 'object',
  required: ['executiveSummary','misconceptions','peerGroup','peerMethodology'],
  properties: {
    executiveSummary: S('600-900 words in markdown. Lead with the single strongest structural finding, then the most credible gaps, then the largest misconceptions this study corrected.'),
    misconceptions: arr(S('One misconception, stated and then corrected with evidence'), '3-6 widely-held but wrong assumptions about this city\'s market'),
    peerGroup: arr({
      type: 'object', required: ['rank','city','score','population','note'],
      properties: {
        rank: { type: 'number' }, city: S('City, region'), score: { type: 'number' },
        population: { type: 'number' }, medianAge: { type: 'number' },
        medianIncome: S('With currency'), note: S('Why it is comparable and where it differs'),
      },
    }, '15-25 peer municipalities ranked by similarity'),
    peerMethodology: S('Markdown. The weighting used, the screens applied, and what was deliberately excluded and why.'),
  },
} as const;

const opportunityProps = {
  rank: { type: 'number' },
  category: S('Business category'),
  description: S('What the business actually is, in plain language'),
  score: { type: 'number', description: '0-100 on the stated model' },
  confidence: { type: 'string', enum: ['high','medium','low'] },
  peerPrevalence: S('Share of peers with the category, and the rate against the CORRECT denominator'),
  denominatorUsed: S('Which denominator this was normalised against and why: residents, daytime/worker population, visitors, catchment, households, or business count'),
  clusteringType: { type: 'string', enum: ['demand-increasing','demand-dividing','conditional'], description: 'Does clustering in this category increase total demand or divide it?' },
  underserviceTests: arr(S('Which of the seven underservice tests this passes, and the evidence'), 'Empty if this is a straightforward absence gap rather than an underserved category'),
  profitabilityData: S('Real profitability if obtainable: NAICS code, % of Ontario firms profitable, and net margin from ISED Financial Performance Data. Say "not retrieved" if you could not get it.'),
  peerExamples: S('Named comparable operators or cities. Verified only.'),
  localSupply: S('What exists locally today and how you counted it'),
  expectedSupply: S('Expected count at the peer median rate, and the resulting gap'),
  leakageTest: S('Explicit result of the 10-20 minute leakage test, naming the nearby providers'),
  demandEvidence: S('Citable local demand signals'),
  whyNotAlready: S('The real reason nobody has done this'),
  ownershipModel: S('Recommended structure and who is best positioned'),
  startupCost: S('Estimated range, labelled as an estimate'),
  timeToRevenue: S('Estimate'),
  staffing: S('Estimate'),
  revenueModel: S('How it makes money'),
  recurringPotential: S('Share of revenue that could recur'),
  bestOperator: S('Who should build it'),
  risks: S('Top three risks'),
  realityCheck: S('Verdict of the adversarial review'),
  disprovingEvidence: S('What specific evidence would kill this'),
  sources: arr(S('URL'), 'Source URLs supporting this entry'),
};

export const opportunitiesSchema = {
  type: 'object',
  required: ['opportunities'],
  properties: {
    opportunities: arr({ type: 'object', required: ['rank','category','description','score','confidence'], properties: opportunityProps },
      'The top 25 opportunities, ranked by score, highest first. Every one must have survived the reality check.'),
  },
} as const;

export const supportingSchema = {
  type: 'object',
  required: ['expansions','lowCapital','scalable','municipal','falsePositives'],
  properties: {
    expansions: arr({
      type: 'object', required: ['existingBusinessType','proposedExpansion','whyItFits','capital','difficulty'],
      properties: {
        existingBusinessType: S('Business CATEGORY, never a named firm'),
        proposedExpansion: S('The adjacent revenue line'),
        whyItFits: S('Why here specifically'),
        assetsLeveraged: S('What the business already owns that this uses'),
        targetCustomer: S(''),
        comparableExamples: S('Verified examples, or an explicit statement that evidence is weak'),
        capital: S('Estimated range'),
        difficulty: S('low / medium / high'),
        revenuePotential: S('Estimate'),
        risks: S(''),
        evidenceStrength: S('strong / medium-high / medium / weak'),
      },
    }, 'Top 20 complementary expansions'),
    lowCapital: arr({
      type: 'object', required: ['category','score','capital','test'],
      properties: { category: S(''), score: { type: 'number' }, capital: S('Estimate'), test: S('The cheapest test that would prove or kill it') },
    }, 'Top 10 opportunities testable for under about 25,000 in local currency'),
    scalable: arr({
      type: 'object', required: ['category','score','path','obstacle'],
      properties: { category: S(''), score: { type: 'number' }, path: S('How it scales beyond this city'), obstacle: S('The main barrier to scaling') },
    }, 'Top 10 scalable opportunities'),
    municipal: arr({
      type: 'object', required: ['title','sponsor','capital','why'],
      properties: { title: S(''), sponsor: S('Who should sponsor it'), capital: S('Estimate'), why: S('Why this belongs in the public or non-profit sector rather than being a business') },
    }, 'Top 10 municipal, workforce or youth-enterprise opportunities'),
    falsePositives: arr({
      type: 'object', required: ['category','score','rejectionReason'],
      properties: { category: S(''), score: { type: 'number' }, rejectionReason: S('Specific and evidenced. This is the most valuable section of the report.') },
    }, 'At least 15 ideas that look like opportunities here and are not'),
  },
} as const;

export const conceptsSchema = {
  type: 'object',
  required: ['concepts','appendix'],
  properties: {
    concepts: arr({
      type: 'object',
      required: ['title','kind','oneLine','targetCustomer','problemSolved','capital','ninetyDayPlan','killCriteria'],
      properties: {
        title: S(''), kind: { type: 'string', enum: ['standalone','augmentation','municipal'] },
        oneLine: S(''), targetCustomer: S('Exact, not "everyone"'), problemSolved: S(''),
        localEvidence: S('With sources'), peerEvidence: S('With sources'),
        services: S(''), pricing: S('Indicative, labelled as estimates'),
        revenueStreams: S(''), grossMargins: S('CLEARLY MARKED AS ESTIMATES'),
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
        methodology: S('Markdown. Search methodology, sources used, how counts were built.'),
        limitations: arr(S(''), 'Honest data-quality concerns. Be specific about what you could not verify.'),
        unresolvedQuestions: arr(S(''), 'Open questions that would change conclusions'),
        nextSteps: arr(S(''), 'Recommended primary research'),
        sources: arr(S('URL'), 'Major sources used'),
      },
    },
  },
} as const;
