'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { safeFetchJson } from '@/lib/businesses/client';

export default function CityForm({ big = false }: { big?: boolean }) {
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!city.trim()) return;
    setBusy(true); setErr('');
    try {
      const r = await safeFetchJson<{ id: string }>('/api/businesses/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city }),
      });
      if (!r.ok || !r.data?.id) throw new Error(r.error || 'Scan failed');
      router.push(`/businesses/scan/${r.data.id}`);
    } catch (e: any) {
      setErr(e.message || 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div className={`flex flex-col sm:flex-row gap-3 ${big ? '' : 'max-w-xl'}`}>
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Burlington, Ontario"
          disabled={busy}
          className={`flex-1 rounded-lg border border-slate-300 bg-white px-4 ${big ? 'py-4 text-lg' : 'py-3'} outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:opacity-60`}
        />
        <button
          type="submit"
          disabled={busy || !city.trim()}
          className={`rounded-lg bg-slate-900 px-6 ${big ? 'py-4 text-lg' : 'py-3'} font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition`}
        >
          {busy ? 'Scanning…' : 'Scan my city — free'}
        </button>
      </div>
      {busy && (
        <p className="mt-3 text-sm text-slate-500">
          Resolving the city, building a peer group and screening categories. This takes 40–90 seconds.
        </p>
      )}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </form>
  );
}
