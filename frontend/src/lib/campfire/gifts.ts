// Gift-card issuance. Provider-agnostic: pick Tremendous OR Giftbit by env, so the
// rest of the app calls one issueGiftCard() and never cares which is live. With NO
// provider configured it's a silent no-op (callers fall back to "host settles").
//
// Choose the provider with GIFT_PROVIDER = "tremendous" | "giftbit". If unset, it
// auto-detects: Giftbit if GIFTBIT_API_KEY is present, else Tremendous.
//
// Tremendous:
//   TREMENDOUS_API_KEY, TREMENDOUS_FUNDING_SOURCE, TREMENDOUS_CAMPAIGN_ID (optional),
//   TREMENDOUS_ENV ("production" → live; default sandbox), TREMENDOUS_BASE (override)
//
// Giftbit (https://www.giftbit.com — papi/v1):
//   GIFTBIT_API_KEY        — bearer token (Testbed or production)
//   GIFTBIT_ENV            — "production" → live; default "testbed"
//   GIFTBIT_BASE           — optional explicit base URL override
//   GIFTBIT_BRAND_CODES    — comma-separated brand codes the recipient can pick from
//                            (e.g. "amazon_ca" for CAD). Use region-matched brands.
//   GIFTBIT_GIFT_TEMPLATE  — alternative to brand codes: a saved gift-template id
//   GIFTBIT_FROM_NAME      — sender name shown to the recipient (default "Campfire")
// NOTE: verify exact brand codes / field names against your Testbed account before
// going live — Testbed is free and mirrors production (root api-testbed.giftbit.com).

export type GiftResult = { ok: boolean; orderId?: string; error?: string };

type Provider = "tremendous" | "giftbit";

function tremendousReady(): boolean {
  return !!(process.env.TREMENDOUS_API_KEY && process.env.TREMENDOUS_FUNDING_SOURCE);
}
function giftbitReady(): boolean {
  return !!process.env.GIFTBIT_API_KEY;
}

function activeProvider(): Provider | null {
  const forced = (process.env.GIFT_PROVIDER || "").toLowerCase();
  if (forced === "giftbit") return giftbitReady() ? "giftbit" : null;
  if (forced === "tremendous") return tremendousReady() ? "tremendous" : null;
  // Auto-detect: prefer Giftbit when its key is set, else Tremendous.
  if (giftbitReady()) return "giftbit";
  if (tremendousReady()) return "tremendous";
  return null;
}

export function giftProviderConfigured(): boolean {
  return activeProvider() !== null;
}

export type IssueOpts = {
  amountCents: number;
  currency?: string; // ISO code, default USD (used by Tremendous; Giftbit uses brand region)
  recipientEmail: string;
  recipientName?: string;
  note?: string;
  // At-most-once issuance per engagement (provider idempotency key).
  idempotencyKey: string;
};

export async function issueGiftCard(opts: IssueOpts): Promise<GiftResult> {
  const provider = activeProvider();
  if (provider === "giftbit") return issueViaGiftbit(opts);
  if (provider === "tremendous") return issueViaTremendous(opts);
  return { ok: false, error: "Gift provider not configured" };
}

// ─────────────────────────── Tremendous ───────────────────────────
async function issueViaTremendous(opts: IssueOpts): Promise<GiftResult> {
  const apiKey = process.env.TREMENDOUS_API_KEY;
  const funding = process.env.TREMENDOUS_FUNDING_SOURCE;
  if (!apiKey || !funding) return { ok: false, error: "Tremendous not configured" };
  const base =
    process.env.TREMENDOUS_BASE ||
    (process.env.TREMENDOUS_ENV === "production"
      ? "https://www.tremendous.com/api/v2"
      : "https://testflight.tremendous.com/api/v2");
  const campaignId = process.env.TREMENDOUS_CAMPAIGN_ID;

  const payload = {
    external_id: opts.idempotencyKey,
    payment: { funding_source_id: funding },
    rewards: [
      {
        value: {
          denomination: Math.round(opts.amountCents) / 100,
          currency_code: (opts.currency || "usd").toUpperCase(),
        },
        delivery: { method: "EMAIL" },
        recipient: { email: opts.recipientEmail, name: opts.recipientName || "Friend" },
        ...(campaignId ? { campaign_id: campaignId } : {}),
        ...(opts.note ? { message: opts.note } : {}),
      },
    ],
  };
  try {
    const res = await fetch(`${base}/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      order?: { id?: string };
      errors?: { message?: string };
    };
    if (!res.ok) return { ok: false, error: data?.errors?.message || `HTTP ${res.status}` };
    const orderId = data?.order?.id;
    if (!orderId) return { ok: false, error: "No order id returned" };
    return { ok: true, orderId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Request failed" };
  }
}

// ─────────────────────────── Giftbit ───────────────────────────
async function issueViaGiftbit(opts: IssueOpts): Promise<GiftResult> {
  const apiKey = process.env.GIFTBIT_API_KEY;
  if (!apiKey) return { ok: false, error: "Giftbit not configured" };
  const base =
    process.env.GIFTBIT_BASE ||
    (process.env.GIFTBIT_ENV === "production"
      ? "https://api.giftbit.com/papi/v1"
      : "https://api-testbed.giftbit.com/papi/v1");

  const brandCodes = (process.env.GIFTBIT_BRAND_CODES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const giftTemplate = process.env.GIFTBIT_GIFT_TEMPLATE;

  const nameParts = (opts.recipientName || "Friend").trim().split(/\s+/);
  const firstname = nameParts[0] || "Friend";
  const lastname = nameParts.slice(1).join(" ") || "";
  // Expire ~1 year out (YYYY-MM-DD).
  const expiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // POST /campaign creates AND sends. `id` is the idempotency key for the campaign;
  // each gift carries its own uuid. delivery_type GIFTBIT_EMAIL → Giftbit emails the
  // recipient a redemption link for one of the allowed brands.
  const body: Record<string, unknown> = {
    id: opts.idempotencyKey,
    price_in_cents: Math.round(opts.amountCents),
    expiry,
    delivery_type: "GIFTBIT_EMAIL",
    from_name: process.env.GIFTBIT_FROM_NAME || "Campfire",
    subject: (opts.note || "You've received a gift!").slice(0, 120),
    message: opts.note || "Enjoy your gift!",
    gifts: [
      {
        uuid: opts.idempotencyKey,
        firstname,
        lastname,
        email: opts.recipientEmail,
      },
    ],
    ...(giftTemplate ? { gift_template: giftTemplate } : { brand_codes: brandCodes }),
  };

  try {
    const res = await fetch(`${base}/campaign`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      campaign?: { id?: string; uuid?: string };
      id?: string;
      uuid?: string;
      error?: { message?: string };
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data?.error?.message || data?.message || `HTTP ${res.status}`,
      };
    }
    const orderId =
      data?.campaign?.id ||
      data?.campaign?.uuid ||
      data?.id ||
      data?.uuid ||
      opts.idempotencyKey;
    return { ok: true, orderId: String(orderId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Request failed" };
  }
}
