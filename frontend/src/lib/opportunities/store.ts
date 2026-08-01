/**
 * KV storage with three backends, chosen automatically:
 *   1. Supabase  — you already use it. Needs one table (see docs/opportunities-setup.md).
 *   2. Upstash Redis over REST — if you would rather not add a table.
 *   3. Local disk (.data/) — development fallback.
 */
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UP_URL = process.env.UPSTASH_REDIS_REST_URL;
const UP_TOK = process.env.UPSTASH_REDIS_REST_TOKEN;
const TABLE = process.env.OPP_KV_TABLE || 'opportunity_kv';

type Backend = 'supabase' | 'upstash' | 'disk';
const backend: Backend = SB_URL && SB_KEY ? 'supabase' : UP_URL && UP_TOK ? 'upstash' : 'disk';

async function sb(path: string, init: RequestInit) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY!,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

async function upstash(cmd: (string | number)[]) {
  const res = await fetch(UP_URL!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  return (await res.json()).result;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  if (backend === 'supabase') {
    const res = await sb(`${TABLE}?key=eq.${encodeURIComponent(key)}&select=value,expires_at`, { method: 'GET' });
    const rows = await res.json();
    if (!rows?.length) return null;
    const row = rows[0];
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
    return row.value as T;
  }
  if (backend === 'upstash') {
    const r = await upstash(['GET', key]);
    return r ? (JSON.parse(r as string) as T) : null;
  }
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const f = path.join(process.cwd(), '.data', `${key.replace(/[^a-zA-Z0-9._:-]/g, '_')}.json`);
  try { return JSON.parse(await fs.readFile(f, 'utf8')) as T; } catch { return null; }
}

export async function kvSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  if (backend === 'supabase') {
    const expires_at = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
    await sb(TABLE, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{ key, value, expires_at }]),
    });
    return;
  }
  if (backend === 'upstash') {
    const p = JSON.stringify(value);
    await upstash(ttlSeconds ? ['SET', key, p, 'EX', ttlSeconds] : ['SET', key, p]);
    return;
  }
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.join(process.cwd(), '.data');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${key.replace(/[^a-zA-Z0-9._:-]/g, '_')}.json`), JSON.stringify(value), 'utf8');
}

export const storageBackend = () => backend;
export const scanKey = (id: string) => `opp:scan:${id}`;
export const reportKey = (id: string) => `opp:report:${id}`;
export const orderKey = (id: string) => `opp:order:${id}`;
export const cityCacheKey = (slug: string) => `opp:city:${slug}`;
