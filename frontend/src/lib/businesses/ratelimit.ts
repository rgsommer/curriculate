import { kvGet, kvSet } from './store';

/** Fixed-window limiter. The free scan is the only real cost leak, so it is worth blocking
 *  before it is worth optimising. */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const bucket = `opp:rl:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  const current = (await kvGet<number>(bucket)) ?? 0;
  if (current >= limit) return { ok: false };
  await kvSet(bucket, current + 1, windowSeconds + 5);
  return { ok: true };
}

export function clientIp(req: Request) {
  const h = req.headers;
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
}
