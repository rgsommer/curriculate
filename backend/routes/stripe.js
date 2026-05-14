import express from "express";
import Stripe from "stripe";

import mongoose from "mongoose";
import User from "../models/User.js"; // ← adjust path if needed
import ReferralCode from "../models/ReferralCode.js";
import { authAny } from "../middleware/authAny.js";
import { getPriceIdForTier, validatePriceId } from "../config/stripePrices.js";

const router = express.Router();
let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("[stripe] STRIPE_SECRET_KEY is not set");
  return (_stripe = new Stripe(key));
}
const stripe = new Proxy({}, { get: (_, prop) => getStripe()[prop] });
console.log("[stripeRoutes] PATCH LOADED 2025-12-30d");

function successUrl() {
  return process.env.STRIPE_CHECKOUT_SUCCESS_URL || "https://www.curriculate.net/billing/success";
}
function cancelUrl() {
  return process.env.STRIPE_CHECKOUT_CANCEL_URL || "https://www.curriculate.net/pricing";
}

const isHex24 = (s) => typeof s === "string" && /^[a-fA-F0-9]{24}$/.test(s);

router.post("/create-checkout-session", async (req, res) => {
  try {
    const { priceId: clientPriceId, plan, email: rawEmail, referralCode: rawReferralCode } = req.body || {};

    // Bug 5: Accept plan tier and resolve price ID server-side
    // Support both legacy priceId (for backwards compat) and plan tier name
    let priceId = clientPriceId;
    let resolvedPlan = plan;

    if (!priceId && plan && !plan.endsWith("_TRIAL")) {
      // If no priceId but plan tier provided, resolve it server-side
      priceId = getPriceIdForTier(plan);
      if (!priceId) {
        return res.status(400).json({ error: `Invalid plan tier: ${plan}` });
      }
    } else if (!priceId && plan && plan.endsWith("_TRIAL")) {
      // Trial plan: extract base tier and resolve
      const baseTier = plan.replace("_TRIAL", "");
      priceId = getPriceIdForTier(baseTier);
      if (!priceId) {
        return res.status(400).json({ error: `Invalid plan tier: ${baseTier}` });
      }
    }

    if (!priceId) {
      return res.status(400).json({ error: "Missing priceId or valid plan tier" });
    }

    // Validate price ID exists in our config
    if (!validatePriceId(priceId)) {
      return res.status(400).json({ error: "Invalid or unknown Stripe price ID" });
    }

    // Optional: trial support via plan token (e.g., "TEACHER_PRO_TRIAL")
    const isTrial = typeof resolvedPlan === "string" && resolvedPlan.endsWith("_TRIAL");
    const trialDays = Number(process.env.TRIAL_DAYS || 30);

    const email = (rawEmail || "").trim().toLowerCase();

    // 1) Resolve user (logged-in OR email fallback)
    let user = req.user || null;

    if (!user) {
      if (!email) return res.status(401).json({ error: "Not authenticated" });

      user = await User.findOneAndUpdate(
        { email },
        {
          $setOnInsert: {
            email,
            createdAt: new Date(),
            subscriptionTier: "FREE",
            hasUsedTrial: false,
          },
          $set: { updatedAt: new Date() },
        },
        { upsert: true, new: true }
      );
    }

    if (!user) return res.status(401).json({ error: "Not authenticated" });

    // 1.5) Check trial eligibility (Bug 1: enforce hasUsedTrial before checkout)
    if (isTrial && user.hasUsedTrial) {
      return res.status(409).json({ error: "Free trial already used" });
    }

    // 2) Ensure Stripe customer exists
    let stripeCustomerId = user.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email || email || undefined,
        metadata: { userId: String(user._id || "") },
      });

      stripeCustomerId = customer.id;

      // Persist to DB
      await User.updateOne({ _id: user._id }, { $set: { stripeCustomerId, updatedAt: new Date() } });

      // keep local copy consistent
      user.stripeCustomerId = stripeCustomerId;
    }

    // 2.5) Validate referral code if provided
    let validatedReferralCode = "";
    let referralDiscount = 0;
    let stripePromotionCodeId = null; // direct Stripe promo (e.g. CONFERENCE2025)
    if (rawReferralCode) {
      const rc = String(rawReferralCode).toUpperCase().trim();
      const refDoc = await ReferralCode.findOne({ code: rc, disabled: { $ne: true } }).lean();
      if (refDoc) {
        const notExpired = !refDoc.expiresAt || new Date(refDoc.expiresAt) >= new Date();
        if (notExpired) {
          validatedReferralCode = rc;
          referralDiscount = refDoc.customerDiscountPercent || 0;
        }
      }
      // Fallback: if the code isn't in our ReferralCode collection,
      // try to resolve it as a Stripe-side promotion code (e.g. our
      // CONFERENCE2025 emails advertise this code; it lives in the
      // Stripe dashboard, not in our DB).  When found, attach it to
      // the checkout session so the discount auto-applies — the user
      // doesn't have to retype it on Stripe's page.
      if (!referralDiscount) {
        try {
          const promoList = await stripe.promotionCodes.list({
            code: rc,
            active: true,
            limit: 1,
          });
          const promo = promoList?.data?.[0];
          if (promo?.id) {
            stripePromotionCodeId = promo.id;
            validatedReferralCode = rc;
          }
        } catch (promoErr) {
          console.warn("[stripe] Promotion-code lookup failed:", promoErr.message);
        }
      }
    }

    // 3) Create checkout session
    // If the referral code offers a customer discount, create a Stripe coupon.
    // If the referral code IS a Stripe promotion code (e.g. CONFERENCE2025),
    // attach the promotion_code directly so it auto-applies.
    let discounts = undefined;
    if (referralDiscount > 0) {
      try {
        const coupon = await stripe.coupons.create({
          percent_off: referralDiscount,
          duration: "once",
          name: `Referral: ${validatedReferralCode}`,
        });
        discounts = [{ coupon: coupon.id }];
      } catch (couponErr) {
        console.warn("[stripe] Failed to create referral coupon:", couponErr.message);
      }
    } else if (stripePromotionCodeId) {
      discounts = [{ promotion_code: stripePromotionCodeId }];
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId || undefined,
      customer_email: stripeCustomerId ? undefined : (user.email || email || undefined),
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${successUrl()}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl(),
      ...(discounts ? { discounts } : { allow_promotion_codes: true }),
      client_reference_id: String(user._id),
      subscription_data: {
        metadata: {
          plan: plan || "",
          userId: String(user._id),
          userEmail: user.email || email || "",
          referralCode: validatedReferralCode,
        },
        ...(isTrial ? { trial_period_days: trialDays } : {}),
      },
      metadata: {
        referralCode: validatedReferralCode,
      },
    });

    // 4) After successful checkout creation, mark trial as used (Bug 1: set hasUsedTrial)
    if (isTrial) {
      await User.updateOne({ _id: user._id }, { $set: { hasUsedTrial: true, updatedAt: new Date() } });
    }

    return res.json({ url: session.url });
  } catch (e) {
    console.error("[stripe] create-checkout-session error:", e);
    return res.status(500).json({ error: e?.message || "Failed to create checkout session" });
  }
});

// Bug 5: New endpoint for frontend to fetch current price IDs
// Prevents hardcoding prices on frontend
router.get("/prices", (req, res) => {
  try {
    const prices = {
      TEACHER_PLUS_MONTHLY: process.env.STRIPE_PRICE_TEACHER_PLUS_MONTHLY || "price_1SjgbNLduAaZuYj5Y8h138iq",
      TEACHER_PRO_MONTHLY: process.env.STRIPE_PRICE_TEACHER_PRO_MONTHLY || "price_1SjganLduAaZuYj5e0YozeDy",
      SCHOOL_PLUS_YEARLY: process.env.STRIPE_PRICE_SCHOOL_PLUS_YEARLY || "price_1SjgbuLduAaZuYj5qy8o6OSR",
      SCHOOL_PRO_YEARLY: process.env.STRIPE_PRICE_SCHOOL_PRO_YEARLY || "price_1SjgcTLduAaZuYj5LlaHf5M9",
    };
    res.json(prices);
  } catch (e) {
    console.error("[stripe] /prices error:", e);
    res.status(500).json({ error: "Failed to fetch prices" });
  }
});

router.use(authAny);

router.post("/create-portal-session", async (req, res) => {
  try {
    const user = req.user;
    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: "No Stripe customer on file for this user" });
    }

    const returnUrl =
      (req.body && req.body.returnUrl) ||
      process.env.STRIPE_PORTAL_RETURN_URL ||
      "https://www.curriculate.net/my-plan";

    const portal = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });

    res.json({ url: portal.url });
  } catch (e) {
    console.error("[stripe] create-portal-session error:", e);
    res.status(500).json({ error: e?.message || "Failed to create portal session" });
  }
});

export default router;
