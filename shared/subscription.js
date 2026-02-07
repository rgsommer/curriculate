// backend/shared/subscription.js
// Central place for tier limits & helper functions

export const TIERS = {
  FREE: 'FREE',
  PLUS: 'PLUS',
  PRO: 'PRO',
};

export const TIER_LIMITS = {
  [TIERS.FREE]: {
    maxWordListWords: 10,       // "Can only insert up to 10 words"
    maxTasksPerSet: 5,          // "Basic task sets of 5 tasks or less"
    maxAiSetsPerMonth: 1,       // "1 AI task set per month"
    reportingLevel: 'session-only', // only session summary
  },
  [TIERS.PLUS]: {
    maxWordListWords: 100,
    maxTasksPerSet: 20,
    maxAiSetsPerMonth: 50,
    reportingLevel: 'team-level',   // team analytics + better reports
  },
  [TIERS.PRO]: {
    maxWordListWords: 9999,
    maxTasksPerSet: 50,
    maxAiSetsPerMonth: 9999,
    reportingLevel: 'student-level', // full analytics + student PDFs
  },
};

/**
 * Get limits for a tier. Defaults to FREE if unknown.
 */
export function getTierLimits(tier) {
  if (!tier || !TIER_LIMITS[tier]) return TIER_LIMITS[TIERS.FREE];
  return TIER_LIMITS[tier];
}

/**
 * Check if presenter can create another AI task set this month.
 * 
 * @param {Object} presenter - presenter profile doc with subscriptionTier
 * @param {number} aiSetsThisMonth - count of AI task sets created in last 30 days
 * @returns {boolean}
 */
export function canCreateAiTaskSet(presenter, aiSetsThisMonth) {
  const tier = presenter?.subscriptionTier || TIERS.FREE;
  const limits = getTierLimits(tier);
  return aiSetsThisMonth < limits.maxAiSetsPerMonth;
}

/**
 * Validate task set constraints per tier.
 * 
 * @param {Object} presenter
 * @param {Object} taskSetConfig - e.g. { wordListCount, taskCount }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateTaskSetForTier(presenter, taskSetConfig) {
  const tier = presenter?.subscriptionTier || TIERS.FREE;
  const limits = getTierLimits(tier);
  const { wordListCount = 0, taskCount = 0 } = taskSetConfig;

  if (wordListCount > limits.maxWordListWords) {
    return {
      ok: false,
      reason: `Your current plan allows up to ${limits.maxWordListWords} words in a word list.`,
    };
  }

  if (taskCount > limits.maxTasksPerSet) {
    return {
      ok: false,
      reason: `Your current plan allows task sets with up to ${limits.maxTasksPerSet} tasks.`,
    };
  }

  return { ok: true };
}

/**
 * Generate gentle teaser text for a given tier & feature context.
 * This is used in PDFs and on-screen reports.
 * 
 * @param {string} tier
 * @param {string} context - 'reporting', 'ai-tasks', etc.
 * @returns {string[]} array of short teaser lines
 */
export function getUpgradeTeasers(tier, context = 'reporting') {
  const teasers = [];

  if (tier === TIERS.FREE) {
    if (context === 'reporting') {
      teasers.push(
        'Want team-by-team analytics and deeper insights? Try the PLUS plan.',
        'Individual student reports are available with the PRO plan.',
      );
    }
    if (context === 'ai-tasks') {
      teasers.push(
        'Enjoying AI task sets? PLUS and PRO include more AI sets each month.'
      );
    }
  }

  if (tier === TIERS.PLUS) {
    if (context === 'reporting') {
      teasers.push(
        'Generate individual student PDFs and richer photo galleries with the PRO plan.'
      );
    }
    if (context === 'ai-tasks') {
      teasers.push(
        'Need unlimited AI task sets and advanced scoring? PRO has you covered.'
      );
    }
  }

  // PRO usually gets no teasers, or extremely soft future-facing ones.
  if (tier === TIERS.PRO) {
    // Optionally: tease future add-ons here.
  }

  return teasers;
}
