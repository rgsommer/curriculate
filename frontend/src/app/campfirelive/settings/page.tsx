"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { supabase } from "@/lib/campfire/supabase";

export default function SettingsPage() {
  const { user, profile, isTrialActive, trialDaysLeft, refreshProfile, signOut } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  // Pre-fill the field once the profile loads (so it shows the current name).
  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile?.display_name]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const handleDeleteAccount = async () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Permanently delete your account and any groups you host? This cannot be undone."
      )
    )
      return;
    setDeleting(true);
    const { error } = await supabase.rpc("campfire_delete_account");
    if (error) {
      setDeleting(false);
      alert("Couldn't delete your account: " + error.message);
      return;
    }
    await signOut();
    router.replace("/campfirelive");
  };

  const handleSave = async () => {
    if (!user || !displayName.trim()) return;
    setSaving(true);
    await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() })
      .eq("id", user.id);
    await refreshProfile();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const trialEndDate = profile?.trial_ends_at
    ? new Date(profile.trial_ends_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="max-w-lg">
      <Link
        href="/campfirelive"
        className="text-sm text-slate-500 hover:text-slate-700 mb-4 inline-block"
      >
        ← Dashboard
      </Link>

      <h1 className="text-2xl font-extrabold text-slate-900 mb-6">Settings</h1>

      {/* Profile */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm mb-6">
        <h2 className="font-bold text-slate-900 mb-4">Profile</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={user?.email ?? ""}
              disabled
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-500"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !displayName.trim()}
            className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : saved ? "✓ Saved" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Subscription */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm mb-6">
        <h2 className="font-bold text-slate-900 mb-4">Subscription</h2>

        {profile?.is_premium ? (
          <div className="rounded-xl bg-green-50 border border-green-200 p-4 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">⭐</span>
              <div>
                <div className="font-bold text-green-900">Premium Active</div>
                <div className="text-sm text-green-700">
                  You have full access to all Campfire features.
                </div>
              </div>
            </div>
          </div>
        ) : isTrialActive ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">⏱️</span>
              <div>
                <div className="font-bold text-amber-900">Free Trial</div>
                <div className="text-sm text-amber-700">
                  {trialDaysLeft} days remaining (ends {trialEndDate}).
                  Full access to all features during your trial.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <div>
                <div className="font-bold text-red-900">Trial Expired</div>
                <div className="text-sm text-red-700">
                  Your free trial ended on {trialEndDate}. Upgrade to continue
                  creating groups and engagements.
                </div>
              </div>
            </div>
          </div>
        )}

        {!profile?.is_premium && (
          /* Premium purchase is hidden in the iOS app (App Store 3.1.1 — digital
             goods must use Apple IAP). Web & Android keep it. */
          <div data-hide-on-ios className="space-y-3">
            <div className="rounded-xl border-2 border-orange-300 bg-gradient-to-r from-orange-50 to-rose-50 p-5">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-bold text-slate-900">Campfire Premium</h3>
                  <p className="text-sm text-slate-600">Everything you need for your groups</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-slate-900">$4.99</div>
                  <div className="text-xs text-slate-500">/month</div>
                </div>
              </div>
              <ul className="text-sm text-slate-700 space-y-1.5 mb-4">
                {[
                  "Unlimited groups and engagements",
                  "No ads",
                  "Priority support",
                  "Expanded random guest pools",
                  "Advanced group analytics",
                  "Export to social media",
                  "Exclusive engagement types",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="text-orange-500">✓</span> {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={async () => {
                  // In production: create Stripe Checkout session via API route
                  // For now, placeholder
                  alert(
                    "Stripe Checkout will open here. Connect your Stripe account to enable payments."
                  );
                }}
                className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white shadow-sm hover:opacity-90"
              >
                Upgrade to Premium
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Preferences */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm mb-6">
        <h2 className="font-bold text-slate-900 mb-4">Preferences</h2>
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={profile?.allow_random_guest ?? false}
            onChange={async (e) => {
              if (!user) return;
              await supabase
                .from("profiles")
                .update({ allow_random_guest: e.target.checked })
                .eq("id", user.id);
              await refreshProfile();
            }}
            className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
          />
          <div>
            <div className="text-sm font-medium text-slate-700">Available as random guest</div>
            <div className="text-xs text-slate-500">
              Let other groups invite you as a random participant
            </div>
          </div>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={profile?.adult_content ?? false}
            onChange={async (e) => {
              if (!user) return;
              await supabase
                .from("profiles")
                .update({ adult_content: e.target.checked })
                .eq("id", user.id);
              await refreshProfile();
            }}
            className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
          />
          <div>
            <div className="text-sm font-medium text-slate-700">Adult content</div>
            <div className="text-xs text-slate-500">
              Enable adult-oriented Truth or Dare packs and content
            </div>
          </div>
        </label>
      </div>

      {/* Sign out */}
      <button
        onClick={signOut}
        className="rounded-full border border-red-300 px-6 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        Sign Out
      </button>

      {/* Danger zone: permanent account deletion */}
      <div className="mt-8 rounded-2xl border border-red-200 bg-red-50/50 p-6">
        <h2 className="font-bold text-red-900 mb-1">Delete account</h2>
        <p className="text-sm text-red-800/80 mb-4">
          Permanently deletes your account, your profile, and{" "}
          <span className="font-semibold">any groups you host</span> (including their
          activities and everyone&apos;s responses in them). This can&apos;t be undone.
        </p>
        <button
          onClick={handleDeleteAccount}
          disabled={deleting}
          className="rounded-full border border-red-400 bg-white px-5 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete my account"}
        </button>
      </div>
    </div>
  );
}
