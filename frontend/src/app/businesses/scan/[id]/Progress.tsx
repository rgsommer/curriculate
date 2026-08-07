'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { safeFetchJson } from '@/lib/businesses/client';

/** Drives the async scan: kicks the worker, polls for completion, refreshes the page. */
export default function Progress({ id, city }: { id: string; city: string }) {
  const router = useRouter();
  const kicking = useRef(false);
  const [note, setNote] = useState('Resolving the city and building the peer groups…');

  useEffect(() => {
    let stop = false;
    async function kick() {
      if (kicking.current) return;
      kicking.current = true;
      await safeFetchJson('/api/businesses/scan-run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      kicking.current = false;
    }
    async function tick() {
      const r = await safeFetchJson<{ status: string; error?: string }>(`/api/businesses/scan/${id}`, { cache: 'no-store' });
      if (stop) return;
      if (r.ok && r.data && r.data.status !== 'running') { router.refresh(); return; }
      setNote('Screening business categories against both peer groups…');
      kick();
      setTimeout(tick, 5000);
    }
    kick();
    const t = setTimeout(tick, 4000);
    return () => { stop = true; clearTimeout(t); };
  }, [id, router]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-24">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">Scanning</p>
      <h1 className="mt-3 text-3xl font-bold text-slate-900">Analysing {city}</h1>
      <p className="mt-3 text-slate-600">{note}</p>
      <div className="mt-6 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full w-2/5 animate-pulse rounded-full bg-slate-900" />
      </div>
      <p className="mt-6 text-sm text-slate-500">
        This takes 40–90 seconds. The page updates itself — you can leave it open.
      </p>
    </main>
  );
}
