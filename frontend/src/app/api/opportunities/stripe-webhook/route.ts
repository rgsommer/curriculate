import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/opportunities/stripe';
import { kvGet, kvSet, orderKey, reportKey, scanKey } from '@/lib/opportunities/store';
import type { Order, FullReport, ScanResult } from '@/lib/opportunities/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Separate from any existing Stripe webhook in this app — give it its own endpoint and
 *  its own signing secret in the Stripe dashboard. */
export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.OPP_STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return NextResponse.json({ error: 'Not configured' }, { status: 400 });

  const raw = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch (e: any) {
    return NextResponse.json({ error: `Signature verification failed: ${e.message}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any;
    if (session.metadata?.product !== 'opportunities') return NextResponse.json({ ignored: true });
    const scanId = session.metadata?.scanId;
    if (scanId) {
      const order: Order = (await kvGet<Order>(orderKey(scanId))) ?? {
        id: scanId, scanId, paid: false,
        amountCents: session.amount_total ?? 0, currency: session.currency ?? 'cad',
      };
      order.paid = true;
      order.paidAt = Date.now();
      order.email = session.customer_details?.email ?? order.email;
      await kvSet(orderKey(scanId), order);

      const scan = await kvGet<ScanResult>(scanKey(scanId));
      const existing = await kvGet<FullReport>(reportKey(scanId));
      if (scan && !existing) {
        await kvSet(reportKey(scanId), {
          id: scanId, city: scan.city, createdAt: Date.now(),
          status: 'queued', progress: { phase: 'Queued', pct: 0 },
        } as Partial<FullReport>);
      }
    }
  }
  return NextResponse.json({ received: true });
}
