import { NextResponse } from 'next/server';
import { withApi } from '@/lib/businesses/http';
import { kvGet, scanKey } from '@/lib/businesses/store';
import type { ScanResult } from '@/lib/businesses/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } | Promise<{ id: string }> };

export const GET = withApi(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const scan = await kvGet<ScanResult>(scanKey(id));
  if (!scan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(scan);
});
