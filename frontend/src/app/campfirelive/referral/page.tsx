"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { supabase } from "@/lib/campfire/supabase";
import { formatMoney } from "@/lib/campfire/types";

type Row = {
  code: string;
  groups_referred: number;
  gift_volume_cents: number;
  earned_cents: number;
};

export default function ReferralDashboard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("my_referral_earnings");
      if (!cancelled) setRows((data as Row[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://www.curriculate.net";
  const linkFor = (code: string) => `${origin}/campfirelive?ref=${encodeURIComponent(code)}`;

  return (
    <div className="max-w-lg">
      <Link
        href="/campfirelive"
        className="mb-4 inline-block text-sm text-slate-500 hover:text-slate-700"
      >
        ← Back
      </Link>
      <h1 className="mb-1 text-2xl font-extrabold text-slate-900">
        Referral partner 🎁
      </h1>
      <p className="mb-6 text-slate-500">
        Share your link. When a group you referred runs a gift, you earn a share of a
        small service fee — paid out manually.
      </p>

      {rows === null ? (
        <div className="text-slate-400 animate-pulse">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          You don&apos;t have a referral code yet. Reach out to get set up as a partner.
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <div
              key={r.code}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-extrabold text-slate-900">
                    {r.groups_referred}
                  </div>
                  <div className="text-[11px] text-slate-500">Groups</div>
                </div>
                <div>
                  <div className="text-lg font-extrabold text-slate-900">
                    {formatMoney(r.gift_volume_cents)}
                  </div>
                  <div className="text-[11px] text-slate-500">Gift volume</div>
                </div>
                <div>
                  <div className="text-lg font-extrabold text-emerald-600">
                    {formatMoney(r.earned_cents)}
                  </div>
                  <div className="text-[11px] text-slate-500">Earned</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={linkFor(r.code)}
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
                />
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(linkFor(r.code));
                      setCopied(r.code);
                      setTimeout(() => setCopied(null), 1500);
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="rounded-lg bg-gradient-to-r from-orange-500 to-rose-500 px-3 py-2 text-xs font-semibold text-white"
                >
                  {copied === r.code ? "Copied!" : "Copy link"}
                </button>
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-400">
            Earnings shown are your share of the service fee on paid contributions.
            Amounts may span currencies; we&apos;ll reconcile at payout.
          </p>
        </div>
      )}
    </div>
  );
}
