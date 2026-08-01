export type GapType =
  | 'absent' | 'undersupplied' | 'capacity_constrained'
  | 'quality_gap' | 'segment_gap' | 'format_gap' | 'exiting';

export const GAP_TYPE_LABEL: Record<GapType, string> = {
  absent: 'Absent',
  undersupplied: 'Undersupplied',
  capacity_constrained: 'Capacity constrained',
  quality_gap: 'Quality gap',
  segment_gap: 'Segment gap',
  format_gap: 'Format gap',
  exiting: 'Exiting / vacuum',
};

export interface CityRef {
  raw: string; name: string; region: string; country: string;
  population?: number; slug: string;
}

export interface Teaser {
  domain: string; count: number; topScore: number; hint: string;
}

export interface ScanResult {
  id: string; city: CityRef; createdAt: number;
  status: 'running' | 'ready' | 'error'; error?: string;
  categoriesScreened: number;
  opportunityCount: number; strongCount: number; moderateCount: number;
  falsePositiveCount: number;
  typeBreakdown: { type: GapType; count: number }[];
  peerCities: { name: string; score: number }[];
  profileHighlights: { label: string; value: string }[];
  teasers: Teaser[];
  headlineTheme: string;
}

export interface Financials {
  volumeDriver: string;          // e.g. "18 jobs/month by month 12"
  volumeBasis: string;           // where that number comes from
  averageTransaction: string;
  revenueYear1: string; revenueYear2: string; revenueYear3: string;
  grossMarginPct: string;
  fixedCosts: string;            // itemised
  netIncomeYear1: string; netIncomeYear2: string; netIncomeYear3: string;
  breakevenMonths: string;
  ownerSalaryTreatment: string;  // before or after owner's pay
  sensitivities: string;         // the three assumptions it turns on
}

export interface Opportunity {
  rank: number; category: string; description: string;
  gapType: GapType; gapEvidence: string;
  score: number; confidence: 'high' | 'medium' | 'low';
  peerPrevalence: string; peerExamples: string;
  localSupply: string; incumbentQuality: string; expectedSupply: string;
  leakageTest: string; demandEvidence: string; whyNotAlready: string;
  incumbentResponse: string;     // what stops the incumbent simply fixing this
  ownershipModel: string; bestOperator: string;
  startupCost: string; timeToRevenue: string; staffing: string;
  revenueModel: string; recurringPotential: string;
  financials: Financials;
  risks: string; realityCheck: string; disprovingEvidence: string;
  sources: string[];
}

export interface Expansion {
  existingBusinessType: string; proposedExpansion: string; whyItFits: string;
  assetsLeveraged: string; targetCustomer: string; comparableExamples: string;
  capital: string; difficulty: string; revenuePotential: string;
  netIncomeEstimate: string; risks: string; evidenceStrength: string;
}

export interface LaunchConcept {
  title: string; kind: 'standalone' | 'augmentation' | 'municipal';
  oneLine: string; targetCustomer: string; problemSolved: string;
  localEvidence: string; peerEvidence: string; services: string; pricing: string;
  revenueStreams: string; grossMargins: string; financials: Financials;
  capital: string; staffing: string; equipment: string; property: string;
  licensing: string; insurance: string; salesStrategy: string;
  marketingChannels: string; partnerships: string;
  ninetyDayPlan: string; oneYearPlan: string; risks: string;
  killCriteria: string; evidenceStillNeeded: string;
}

export interface FullReport {
  id: string; city: CityRef; createdAt: number;
  status: 'queued' | 'running' | 'ready' | 'error';
  progress: { phase: string; pct: number }; error?: string;
  executiveSummary: string;
  misconceptions: string[];
  peerGroup: { rank: number; city: string; score: number; population: number;
    medianAge?: number; medianIncome?: string; note: string }[];
  peerMethodology: string;
  opportunities: Opportunity[];
  expansions: Expansion[];
  lowCapital: { category: string; score: number; capital: string; netIncomeYear2: string; test: string }[];
  scalable: { category: string; score: number; path: string; obstacle: string }[];
  municipal: { title: string; sponsor: string; capital: string; why: string }[];
  falsePositives: { category: string; score: number; rejectionReason: string }[];
  concepts: LaunchConcept[];
  appendix: {
    methodology: string; limitations: string[];
    unresolvedQuestions: string[]; nextSteps: string[]; sources: string[];
  };
}

export interface Order {
  id: string; scanId: string; email?: string; stripeSessionId?: string;
  paid: boolean; paidAt?: number; amountCents: number; currency: string;
  notified?: boolean;
}
