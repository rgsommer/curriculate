// Gift-card issuance via Tremendous (https://tremendous.com). Configured by env so
// it's a silent no-op until you set it up — and defaults to the SANDBOX so nothing
// real is sent while testing.
//
//   TREMENDOUS_API_KEY         — bearer token (sandbox or production)
//   TREMENDOUS_FUNDING_SOURCE  — funding source id (your Tremendous balance)
//   TREMENDOUS_CAMPAIGN_ID     — optional campaign that defines the card options
//                                (Visa / Amazon / etc.) the recipient can pick from
//   TREMENDOUS_ENV             — "production" to hit the live API (default: sandbox)
//   TREMENDOUS_BASE            — optional explicit base URL override

export type GiftResult = { ok: boolean; orderId?: string; error?: string };

export function giftProviderConfigured(): boolean {
  return !!(process.env.TREMENDOUS_API_KEY && process.env.TREMENDOUS_FUNDING_SOURCE);
}

export async function issueGiftCard(opts: {
  amountCents: number;
  currency?: string; // ISO code, default USD
  recipientEmail: string;
  recipientName?: string;
  note?: string;
  // Tremendous external_id → at-most-once issuance per engagement.
  idempotencyKey: string;
}): Promise<GiftResult> {
  const apiKey = process.env.TREMENDOUS_API_KEY;
  const funding = process.env.TREMENDOUS_FUNDING_SOURCE;
  if (!apiKey || !funding) {
    return { ok: false, error: "Gift provider not configured" };
  }
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
        recipient: {
          email: opts.recipientEmail,
          name: opts.recipientName || "Friend",
        },
        ...(campaignId ? { campaign_id: campaignId } : {}),
        ...(opts.note ? { message: opts.note } : {}),
      },
    ],
  };

  try {
    const res = await fetch(`${base}/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      order?: { id?: string };
      errors?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, error: data?.errors?.message || `HTTP ${res.status}` };
    }
    const orderId = data?.order?.id;
    if (!orderId) return { ok: false, error: "No order id returned" };
    return { ok: true, orderId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Request failed" };
  }
}
