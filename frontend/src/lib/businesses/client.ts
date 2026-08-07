/**
 * Client fetch that never yields "Unexpected end of JSON input" or a bare "Failed to fetch".
 * Reads the body as text first, then decides.
 */
export async function safeFetchJson<T = any>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e: any) {
    return { ok: false, status: 0, error:
      'Could not reach the server — the request may have timed out. (' + (e?.message || 'network error') + ')' };
  }
  const text = await res.text().catch(() => '');
  if (!text) {
    return { ok: false, status: res.status, error: res.status >= 500
      ? `The server returned an empty ${res.status}. Check /api/businesses/health.`
      : `Empty response (HTTP ${res.status}).` };
  }
  try {
    const data = JSON.parse(text);
    if (!res.ok) return { ok: false, status: res.status, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, status: res.status, data };
  } catch {
    const snip = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    return { ok: false, status: res.status, error: `HTTP ${res.status}, not JSON. ${snip}` };
  }
}
