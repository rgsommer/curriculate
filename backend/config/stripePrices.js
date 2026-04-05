/**
 * Stripe Price ID Configuration
 * Bug 5: Single source of truth for price IDs (used by backend)
 * The frontend should reference this via an API endpoint, not hardcode IDs.
 */

const STRIPE_PRICES = {
  TEACHER_PLUS_MONTHLY: process.env.STRIPE_PRICE_TEACHER_PLUS_MONTHLY || "price_1SjgbNLduAaZuYj5Y8h138iq",
  TEACHER_PRO_MONTHLY: process.env.STRIPE_PRICE_TEACHER_PRO_MONTHLY || "price_1SjganLduAaZuYj5e0YozeDy",
  SCHOOL_PLUS_YEARLY: process.env.STRIPE_PRICE_SCHOOL_PLUS_YEARLY || "price_1SjgbuLduAaZuYj5qy8o6OSR",
  SCHOOL_PRO_YEARLY: process.env.STRIPE_PRICE_SCHOOL_PRO_YEARLY || "price_1SjgcTLduAaZuYj5LlaHf5M9",
};

// Map plan tier names to price IDs
const TIER_TO_PRICE_ID = {
  TEACHER_PLUS: STRIPE_PRICES.TEACHER_PLUS_MONTHLY,
  TEACHER_PRO: STRIPE_PRICES.TEACHER_PRO_MONTHLY,
  SCHOOL_PLUS: STRIPE_PRICES.SCHOOL_PLUS_YEARLY,
  SCHOOL_PRO: STRIPE_PRICES.SCHOOL_PRO_YEARLY,
};

export function getPriceIdForTier(tier) {
  return TIER_TO_PRICE_ID[tier] || null;
}

export function validatePriceId(priceId) {
  return Object.values(STRIPE_PRICES).includes(priceId);
}

export { STRIPE_PRICES };
