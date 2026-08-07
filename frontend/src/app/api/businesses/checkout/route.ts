import { NextRequest, NextResponse } from 'next/server';
import { withApi } from '@/lib/businesses/http';
import { stripe, PRICE_CENTS, CURRENCY, siteUrl } from '@/lib/businesses/stripe';
import { kvGet, kvSet, scanKey, orderKey } from '@/lib/businesses/store';
import type { ScanResult, Order } from '@/lib/businesses/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(async (req: NextRequest) => {
  const { scanId, email } = await req.json();
  const scan = await kvGet<ScanResult>(scanKey(String(scanId)));
  if (!scan || scan.status !== 'ready') {
    return NextResponse.json({ error: 'Run a scan first.' }, { status: 400 });
  }
  const cityLabel = [scan.city.name, scan.city.region].filter(Boolean).join(', ');

  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: email || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: CURRENCY,
        unit_amount: PRICE_CENTS,
        product_data: {
          name: `Opportunity Gap Report — ${cityLabel}`,
          description:
            `${scan.opportunityCount} scored opportunities with net income projections, ranked peer group, ` +
            `20 complementary expansions, low-capital and scalable lists, municipal programmes, ` +
            `false positives, and three launch packages.`,
        },
      },
    }],
    metadata: { scanId: scan.id, citySlug: scan.city.slug, cityLabel, product: 'opportunities' },
    success_url: `${siteUrl()}/businesses/success?id=${scan.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl()}/businesses/scan/${scan.id}?cancelled=1`,
  });

  const order: Order = {
    id: scan.id, scanId: scan.id, email, stripeSessionId: session.id,
    paid: false, amountCents: PRICE_CENTS, currency: CURRENCY,
  };
  await kvSet(orderKey(scan.id), order);
  return NextResponse.json({ url: session.url });
});
