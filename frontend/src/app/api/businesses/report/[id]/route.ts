import { NextResponse } from 'next/server';
import { withApi } from '@/lib/businesses/http';
import { kvGet, reportKey, orderKey } from '@/lib/businesses/store';
import type { FullReport, Order } from '@/lib/businesses/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } | Promise<{ id: string }> };

export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const order = await kvGet<Order>(orderKey(id));
  const comp = (process.env.OPP_COMP_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  const isComped = Boolean(order?.email && comp.includes(order.email));
  if (!order?.paid && !isComped) {
    return NextResponse.json({ error: 'Payment required', paid: false }, { status: 402 });
  }
  const report = await kvGet<FullReport>(reportKey(id));
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(report);
});
