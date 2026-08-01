import Stripe from 'stripe';

let _stripe: Stripe | null = null;
/** No apiVersion pin — uses the account default, which keeps this compatible with whatever
 *  Stripe version the rest of the app is on. */
export function stripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

export const PRICE_CENTS = Number(process.env.OPP_PRICE_CENTS || 2999);
export const CURRENCY = (process.env.OPP_CURRENCY || 'cad').toLowerCase();
export const siteUrl = () =>
  (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.curriculate.net').replace(/\/$/, '');
