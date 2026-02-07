const PLAN_RULES = {
  FREE: {
    canSaveTaskSets: false,
    maxWordListLength: 12,
    storeAnalytics: false, // only ephemeral in-memory scoreboard
    emailReports: false,
    pdfReports: false,
  },
  PLUS: {
    canSaveTaskSets: true,
    maxWordListLength: 75,
    storeAnalytics: true,
    emailReports: false,
    pdfReports: false,
  },
  PRO: {
    canSaveTaskSets: true,
    maxWordListLength: 1000,
    storeAnalytics: true,
    emailReports: true,
    pdfReports: true,
  },
};

function getPlanRules(tier) {
  return PLAN_RULES[tier] || PLAN_RULES.FREE;
}

module.exports = { PLAN_RULES, getPlanRules };
