"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { useGroups } from "@/lib/campfire/hooks";
import { supabase } from "@/lib/campfire/supabase";
import { ENGAGEMENT_TYPES, type EngagementType } from "@/lib/campfire/types";

const GROUP_EMOJIS = ["🔥", "🏕️", "⭐", "🌙", "🎯", "💪", "🙏", "🎉", "🎮", "📖", "💑", "🏠"];

export default function DashboardPage() {
  const router = useRouter();
  const { profile, isTrialActive, user } = useAuth();
  const { groups, loading, createGroup, joinGroup } = useGroups();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newEmoji, setNewEmoji] = useState("🔥");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  // The most popular engagement type across all of Campfire right now.
  const [trending, setTrending] = useState<{ type: string; cnt: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc("trending_engagement_type").then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : null;
      if (!cancelled && row?.type) setTrending({ type: row.type, cnt: Number(row.cnt) });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const trendingMeta = trending
    ? ENGAGEMENT_TYPES[trending.type as EngagementType]
    : null;

  // Per-group activity: open-to-sign "active", recurring series, and pending invites.
  const [groupStats, setGroupStats] = useState<
    Record<string, { invited: number; active: number; recurring: number }>
  >({});
  const groupIdsKey = groups.map((g) => g.id).join(",");
  useEffect(() => {
    const ids = groupIdsKey ? groupIdsKey.split(",") : [];
    if (ids.length === 0) {
      setGroupStats({});
      return;
    }
    let cancelled = false;
    (async () => {
      const nowMs = Date.now();
      const [engRes, invRes] = await Promise.all([
        supabase
          .from("engagements")
          .select("group_id, status, launched_at, scheduled_open_at, recurrence_rule")
          .in("group_id", ids),
        supabase
          .from("campfire_invitations")
          .select("group_id")
          .eq("status", "pending")
          .is("engagement_id", null)
          .in("group_id", ids),
      ]);
      if (cancelled) return;
      const stats: Record<string, { invited: number; active: number; recurring: number }> = {};
      ids.forEach((id) => (stats[id] = { invited: 0, active: 0, recurring: 0 }));
      for (const e of engRes.data ?? []) {
        const s = stats[e.group_id as string];
        if (!s || e.status !== "active") continue;
        if (e.recurrence_rule) {
          s.recurring++;
        } else if (
          e.launched_at &&
          (!e.scheduled_open_at || new Date(e.scheduled_open_at as string).getTime() <= nowMs)
        ) {
          s.active++;
        }
      }
      for (const inv of invRes.data ?? []) {
        const s = stats[inv.group_id as string];
        if (s) s.invited++;
      }
      setGroupStats(stats);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIdsKey]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    const { group, error: createError } = await createGroup(
      newName.trim(),
      newDesc.trim(),
      newEmoji
    );
    if (!group) {
      setError(createError ?? "Failed to create group. Try again.");
      setCreating(false);
    } else {
      // Drop straight into the new group so the next steps are obvious.
      router.push(`/campfirelive/group/${group.id}`);
    }
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    setCreating(true);
    setError("");
    const result = await joinGroup(joinCode.trim());
    if (result.error && !result.groupId) {
      setError(result.error);
    } else {
      setShowJoin(false);
      setJoinCode("");
    }
    setCreating(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-slate-400 animate-pulse">Loading your groups...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-slate-900">
          Hey {profile?.display_name ?? "there"} 👋
        </h1>
        <p className="text-slate-500 mt-1">
          {groups.length === 0
            ? "Create your first group or join one with an invite code."
            : `You're in ${groups.length} group${groups.length === 1 ? "" : "s"}.`}
        </p>
      </div>

      {/* Trending across all of Campfire — click to start one in a group */}
      {trendingMeta && trending && (
        groups.length > 0 ? (
          <Link
            href={`/campfirelive/group/${groups[0].id}/engagement/new?type=${trending.type}`}
            className="group mb-6 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50/70 px-3.5 py-1.5 text-xs font-medium text-orange-800 hover:bg-orange-100"
            title={`Start a ${trendingMeta.label} — the most-created type across Campfire right now`}
          >
            <span className="font-semibold">🔥 Trending now</span>
            <span className="text-orange-300">·</span>
            <span>
              {trendingMeta.icon} {trendingMeta.label}
            </span>
            <span className="text-orange-400 group-hover:translate-x-0.5 transition-transform">
              → Try it
            </span>
          </Link>
        ) : (
          <div
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50/70 px-3.5 py-1.5 text-xs font-medium text-orange-800"
            title="The most-created engagement type across Campfire right now"
          >
            <span className="font-semibold">🔥 Trending now</span>
            <span className="text-orange-300">·</span>
            <span>
              {trendingMeta.icon} {trendingMeta.label}
            </span>
          </div>
        )
      )}

      {/* Actions */}
      <div className="flex gap-3 mb-8">
        <button
          onClick={() => { setShowCreate(true); setShowJoin(false); setError(""); }}
          disabled={!isTrialActive}
          className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          + New Group
        </button>
        <button
          onClick={() => { setShowJoin(true); setShowCreate(false); setError(""); }}
          className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Join Group
        </button>
      </div>

      {/* Create Group Modal */}
      {showCreate && (
        <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Create a group</h2>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Group emoji</label>
            <div className="flex flex-wrap gap-2">
              {GROUP_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setNewEmoji(e)}
                  className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center border-2 transition ${
                    newEmoji === e ? "border-orange-500 bg-orange-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Group name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Family, Bible Study, Lads"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Description <span className="text-slate-400">(optional)</span>
            </label>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="What's this group about?"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Group"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-full border border-slate-300 px-6 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Join Group Modal */}
      {showJoin && (
        <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Join a group</h2>
          <p className="text-sm text-slate-500 mb-4">
            Enter the invite code shared by a group member.
          </p>
          <div className="mb-4">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="e.g. AB3XYZ12"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-mono tracking-widest text-center uppercase focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
              maxLength={8}
            />
          </div>
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <div className="flex gap-3">
            <button
              onClick={handleJoin}
              disabled={creating || !joinCode.trim()}
              className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Joining..." : "Join Group"}
            </button>
            <button
              onClick={() => setShowJoin(false)}
              className="rounded-full border border-slate-300 px-6 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Group List */}
      {groups.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-5xl mb-4">🏕️</div>
          <p>No groups yet. Create one or join with an invite code.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => {
            const mine = g.creator_id === user?.id;
            return (
              <Link
                key={g.id}
                href={`/campfirelive/group/${g.id}`}
                className={`rounded-2xl border p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition ${
                  mine
                    ? "border-slate-200 bg-white"
                    : "border-sky-200 bg-sky-50/60"
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-3xl">{g.avatar_emoji}</span>
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900">{g.name}</h3>
                    <p className="text-xs text-slate-500">
                      {g.member_count} member{g.member_count === 1 ? "" : "s"}
                      {mine ? (
                        <span className="ml-1.5 text-orange-600 font-medium">· yours</span>
                      ) : (
                        <span className="ml-1.5 text-sky-700 font-medium">· joined</span>
                      )}
                    </p>
                  </div>
                </div>
                {g.description && (
                  <p className="text-sm text-slate-500 line-clamp-2">{g.description}</p>
                )}
                {(() => {
                  const s = groupStats[g.id];
                  if (!s || s.active + s.recurring + s.invited === 0) return null;
                  return (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-medium text-slate-500">
                      {s.active > 0 && <span>🔥 {s.active} active</span>}
                      {s.recurring > 0 && <span>🔁 {s.recurring} recurring</span>}
                      {s.invited > 0 && <span>✉️ {s.invited} invited</span>}
                    </div>
                  );
                })()}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
