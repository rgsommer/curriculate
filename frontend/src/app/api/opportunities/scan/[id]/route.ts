import { NextResponse } from 'next/server';
import { kvGet, scanKey } from '@/lib/opportunities/store';
import type { ScanResult } from '@/lib/opportunities/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } | Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const scan = await kvGet<ScanResult>(scanKey(id));
  if (!scan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(scan);
}
