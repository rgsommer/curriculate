"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { useGroups } from "@/lib/campfire/hooks";
import { supabase } from "@/lib/campfire/supabase";
import { seasonalCardPrompt } from "@/lib/campfire/templates";
import {
  ENGAGEMENT_TYPES,
  engagementIcon,
  resolveTitle,
  isHouseSchool,
  type EngagementType,
} from "@/lib/campfire/types";

const GROUP_EMOJIS = ["🔥", "🏕️", "⭐", "🌙", "🎯", "💪", "🙏", "🎉", "🎮", "📖", "💑", "🏠"];

// Friendly labels for the ?start=<template> deep link (social-post landing).
const START_TEMPLATE_LABELS: Record<string, string> = {
  "coach-gift": "coach thank-you card 🏆",
  "teacher-appreciation": "teacher appreciation card 🍎",
  "thank-you-card": "thank-you card 💌",
  "christmas-card": "Christmas card 🎄",
  "raffle-challenge": "prize challenge 🏆",
  "raffle-draw": "raffle 🎟️",
  "pledge-drive": "pledge drive 🎗️",
  "celebration-card": "celebration card 🎂",
};

export default function DashboardPage() {
  const router = useRouter();
  const { profile, isTrialActive, user } = useAuth();
  const { groups, loading, createGroup, joinGroup, setGroupNotify } = useGroups();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  // Deep link (?start=<template>): after this group is made, jump straight into a
  // new engagement with that template pre-loaded.
  const [startTemplate, setStartTemplate] = useState<string | null>(null);
  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      const start = qs.get("start") || localStorage.getItem("campfire_start");
      if (start) {
        setStartTemplate(start);
        setShowCreate(true);
      }
    } catch {
      /* ignore */
    }
  }, []);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newEmoji, setNewEmoji] = useState("🔥");
  const [newIsOrg, setNewIsOrg] = useState(false); // for a school/organization?
  const [newSchool, setNewSchool] = useState("");
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

  // "Your turn": active engagements across your groups that YOU haven't responded
  // to yet — so a freshly-logged-in user immediately sees what to do, instead of a
  // wall of groups. Surprise cards you're the recipient of are skipped.
  type TodoEng = {
    id: string;
    group_id: string;
    title: string;
    type: string;
    config: { occasion?: string } | null;
    deadline: string | null;
    birth_year: number | null;
    revealedAt?: string | null;
  };
  const [todo, setTodo] = useState<TodoEng[]>([]);

  // One-time orientation tip for first-timers ("what do I do once I'm in?").
  // Read in an effect (not the initializer) so server and client first-render match.
  const [showTip, setShowTip] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("campfire_dash_tip_v1") !== "dismissed") {
        setShowTip(true);
      }
    } catch {
      /* localStorage blocked — just skip the tip */
    }
  }, []);
  const dismissTip = () => {
    setShowTip(false);
    try {
      localStorage.setItem("campfire_dash_tip_v1", "dismissed");
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    const ids = groupIdsKey ? groupIdsKey.split(",") : [];
    if (ids.length === 0 || !user?.id) {
      setTodo([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const nowMs = Date.now();
      const { data: engs } = await supabase
        .from("engagements")
        .select(
          "id, group_id, title, type, config, deadline, birth_year, launched_at, scheduled_open_at, paused, excluded_user_ids, created_at"
        )
        .in("group_id", ids)
        .eq("status", "active");
      if (cancelled) return;
      // Open to sign now, not paused, and not a card you're the surprise target of.
      const open = (engs ?? []).filter(
        (e) =>
          e.launched_at &&
          !e.paused &&
          (!e.scheduled_open_at ||
            new Date(e.scheduled_open_at as string).getTime() <= nowMs) &&
          !((e.excluded_user_ids as string[] | null) ?? []).includes(user.id)
      );
      if (open.length === 0) {
        setTodo([]);
        return;
      }
      // RLS lets you read your OWN responses — anything missing is awaiting you.
      const { data: mine } = await supabase
        .from("responses")
        .select("engagement_id")
        .eq("user_id", user.id)
        .in(
          "engagement_id",
          open.map((e) => e.id)
        );
      if (cancelled) return;
      const responded = new Set((mine ?? []).map((r) => r.engagement_id as string));
      setTodo(
        open
          .filter((e) => !responded.has(e.id as string))
          .sort(
            (a, b) =>
              new Date(b.created_at as string).getTime() -
              new Date(a.created_at as string).getTime()
          )
          .map((e) => ({
            id: e.id as string,
            group_id: e.group_id as string,
            title: e.title as string,
            type: e.type as string,
            config: (e.config as { occasion?: string } | null) ?? null,
            deadline: (e.deadline as string | null) ?? null,
            birth_year: (e.birth_year as number | null) ?? null,
          }))
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIdsKey, user?.id]);

  // "Revealed!" — engagements across your groups that have just unlocked, so a reveal
  // announces itself instead of silently sliding into the Revealed tab. Per-person:
  // each item stays until you tap it (tracked in localStorage). First load seeds the
  // current reveals as already-seen, so existing ones don't flood the list.
  const [reveals, setReveals] = useState<TodoEng[]>([]);
  const [seenReveals, setSeenReveals] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem("campfire_seen_reveals");
      if (raw) setSeenReveals(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    const ids = groupIdsKey ? groupIdsKey.split(",") : [];
    if (ids.length === 0 || !user?.id) {
      setReveals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const cols =
        "id, group_id, title, type, config, deadline, birth_year, excluded_user_ids, revealed_at";
      const sel = (c: string) =>
        supabase
          .from("engagements")
          .select(c)
          .in("group_id", ids)
          .eq("status", "revealed");
      let res = await sel(cols);
      if (res.error) {
        // revealed_at column not present yet (migration 070) — retry without it.
        res = await sel(cols.replace(", revealed_at", ""));
      }
      if (cancelled) return;
      const rows = (res.data ?? []) as unknown as Array<Record<string, unknown>>;
      const list: TodoEng[] = rows
        .filter(
          (e) =>
            e.type !== "signup" &&
            !((e.excluded_user_ids as string[] | null) ?? []).includes(user.id)
        )
        .map((e) => ({
          id: e.id as string,
          group_id: e.group_id as string,
          title: e.title as string,
          type: e.type as string,
          config: (e.config as { occasion?: string } | null) ?? null,
          deadline: (e.deadline as string | null) ?? null,
          birth_year: (e.birth_year as number | null) ?? null,
          revealedAt:
            (e as { revealed_at?: string | null }).revealed_at ?? null,
        }));
      if (!cancelled) setReveals(list);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIdsKey, user?.id]);
  // Which reveals to surface. A reveal shows if it's within the last week AND either
  // it unlocked today/yesterday (fresh — always shows) or you haven't tapped it yet
  // (stays until you look). No first-load seeding — the 1-week window + cap prevent a
  // flood, and reveal time falls back to the deadline when revealed_at isn't set.
  const nowMs2 = Date.now();
  const startOfYesterday = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 1);
    return d.getTime();
  })();
  const weekAgo = nowMs2 - 7 * 86400000;
  const newReveals = reveals
    .map((e) => {
      const rt = e.revealedAt ? new Date(e.revealedAt).getTime() : null;
      const ref = rt ?? (e.deadline ? new Date(e.deadline).getTime() : 0);
      return { e, rt, ref };
    })
    .filter(({ e, rt, ref }) => {
      const isRecent = rt !== null && rt >= startOfYesterday; // today / yesterday
      const isUnseen = !seenReveals.has(e.id);
      return ref >= weekAgo && (isRecent || isUnseen);
    })
    .sort((a, b) => b.ref - a.ref)
    .slice(0, 12)
    .map(({ e }) => e);
  const markRevealSeen = (id: string) => {
    setSeenReveals((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(
          "campfire_seen_reveals",
          JSON.stringify(Array.from(next))
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Host name for groups you JOINED — keyed by GROUP id, preferring the host's
  // per-group display name ("Dad" in Family) over their global profile name.
  const [creatorNames, setCreatorNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const joined = groups.filter((g) => g.creator_id && g.creator_id !== user?.id);
    if (joined.length === 0) {
      setCreatorNames({});
      return;
    }
    const groupIds = joined.map((g) => g.id);
    const creatorIds = Array.from(new Set(joined.map((g) => g.creator_id as string)));
    let cancelled = false;
    (async () => {
      const [gmRes, profRes] = await Promise.all([
        supabase
          .from("group_members")
          .select("group_id, user_id, display_name")
          .in("group_id", groupIds)
          .in("user_id", creatorIds),
        supabase.from("profiles").select("id, display_name").in("id", creatorIds),
      ]);
      if (cancelled) return;
      // per-group host name (group_id+creator) and global fallback (creator id)
      const perGroup: Record<string, string | null> = {};
      for (const r of gmRes.data ?? [])
        perGroup[`${r.group_id}:${r.user_id}`] = (r.display_name as string | null) ?? null;
      const global: Record<string, string> = {};
      for (const p of profRes.data ?? [])
        global[p.id as string] = (p.display_name as string) || "the host";
      const m: Record<string, string> = {};
      for (const g of joined) {
        m[g.id] =
          perGroup[`${g.id}:${g.creator_id}`] ||
          global[g.creator_id as string] ||
          "the host";
      }
      setCreatorNames(m);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIdsKey, user?.id]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    const { group, error: createError } = await createGroup(
      newName.trim(),
      newDesc.trim(),
      newEmoji,
      newIsOrg ? newSchool.trim() : null
    );
    if (!group) {
      setError(createError ?? "Failed to create group. Try again.");
      setCreating(false);
    } else if (startTemplate) {
      // Deep link: drop straight into the pre-loaded thank-you card.
      try {
        localStorage.removeItem("campfire_start");
      } catch {
        /* ignore */
      }
      router.push(
        `/campfirelive/group/${group.id}/engagement/new?template=${encodeURIComponent(
          startTemplate
        )}`
      );
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
            : todo.length > 0
            ? `You have ${todo.length} thing${todo.length === 1 ? "" : "s"} to respond to 👇`
            : `You're in ${groups.length} group${groups.length === 1 ? "" : "s"}.`}
        </p>
      </div>

      {/* First-time orientation — dismissible, shown once, only when you're
          actually in a group (so it answers "ok, I'm in… now what?"). */}
      {showTip && groups.length > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <span className="text-xl leading-none">💡</span>
          <div className="min-w-0 flex-1 text-sm text-sky-900">
            <span className="font-semibold">New here?</span> When your group has
            something for you, it shows up at the top under{" "}
            <span className="font-semibold">Your turn</span> — just tap it to jump in
            and respond. Tap any group below to see everything it&apos;s running.
          </div>
          <button
            onClick={dismissTip}
            aria-label="Dismiss tip"
            className="flex-shrink-0 rounded-full px-2 py-0.5 text-sky-400 hover:bg-sky-100 hover:text-sky-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* Your turn — the single most important thing on this page. Active
          engagements awaiting THIS user's response, each a one-tap deep link. */}
      {todo.length > 0 && (
        <div className="mb-8 rounded-2xl border-2 border-orange-300 bg-gradient-to-br from-orange-50 to-rose-50 p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xl">👉</span>
            <h2 className="text-base font-extrabold text-slate-900">
              Your turn
              <span className="ml-2 rounded-full bg-orange-500 px-2 py-0.5 text-xs font-bold text-white align-middle">
                {todo.length}
              </span>
            </h2>
            <span className="text-xs text-slate-500">tap to respond</span>
          </div>
          <div className="space-y-2">
            {todo.map((e) => {
              const g = groups.find((gr) => gr.id === e.group_id);
              const meta = ENGAGEMENT_TYPES[e.type as EngagementType];
              return (
                <Link
                  key={e.id}
                  href={`/campfirelive/group/${e.group_id}/engagement/${e.id}`}
                  className="group flex items-center gap-3 rounded-xl border border-orange-200 bg-white px-4 py-3 transition hover:border-orange-400 hover:shadow-sm"
                >
                  <span className="flex-shrink-0 text-2xl">{engagementIcon(e)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900">
                      {resolveTitle(e.title, e.birth_year, e.deadline)}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {meta?.label ?? "Activity"}
                      {g ? ` · ${g.avatar_emoji} ${g.name}` : ""}
                    </div>
                  </div>
                  {/* The whole row is the tap target — just a subtle chevron so the
                      title keeps the full width on a phone. */}
                  <span className="flex-shrink-0 text-lg text-orange-400 transition group-hover:translate-x-0.5 group-hover:text-orange-600">
                    →
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Revealed! — newly-unlocked results, one per person until they look. */}
      {newReveals.length > 0 && (
        <div className="mb-8 rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50 p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xl">🎉</span>
            <h2 className="text-base font-extrabold text-slate-900">
              Revealed!
              <span className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-bold text-white align-middle">
                {newReveals.length}
              </span>
            </h2>
            <span className="text-xs text-slate-500">the results are in — tap to see</span>
          </div>
          <div className="space-y-2">
            {newReveals.map((e) => {
              const g = groups.find((gr) => gr.id === e.group_id);
              const meta = ENGAGEMENT_TYPES[e.type as EngagementType];
              return (
                <Link
                  key={e.id}
                  href={`/campfirelive/group/${e.group_id}/engagement/${e.id}`}
                  onClick={() => markRevealSeen(e.id)}
                  className="group flex items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 transition hover:border-emerald-400 hover:shadow-sm"
                >
                  <span className="flex-shrink-0 text-2xl">{engagementIcon(e)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900">
                      {resolveTitle(e.title, e.birth_year, e.deadline)}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {meta?.label ?? "Activity"}
                      {g ? ` · ${g.avatar_emoji} ${g.name}` : ""}
                    </div>
                  </div>
                  <span className="flex-shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    See it
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Seasonal card nudge — surfaces the right card around Dec / May–June */}
      {(() => {
        const season = seasonalCardPrompt();
        if (!season || groups.length === 0) return null;
        return (
          <Link
            href={`/campfirelive/group/${groups[0].id}/engagement/new?template=${season.templateId}`}
            className="group mb-6 flex items-center justify-between gap-3 rounded-2xl border-2 border-rose-200 bg-gradient-to-br from-rose-50 to-orange-50 px-5 py-4 shadow-sm transition hover:border-rose-300"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-3xl flex-shrink-0">{season.emoji}</span>
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-slate-900">
                  {season.headline}
                </div>
                <div className="text-xs text-slate-600">
                  Everyone signs the card — add a group gift to chip in together.
                </div>
              </div>
            </div>
            <span className="flex-shrink-0 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2 text-sm font-bold text-white group-hover:opacity-90">
              Start →
            </span>
          </Link>
        );
      })()}

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
          {startTemplate && (
            <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
              🍎{" "}
              <span className="font-semibold">
                You&apos;re starting a {START_TEMPLATE_LABELS[startTemplate] ?? "thank-you card"}.
              </span>{" "}
              First, name the group (e.g. &ldquo;Coach Smith&apos;s team&rdquo; or
              &ldquo;Mrs. Lee&apos;s class&rdquo;) — then we&apos;ll open the card for
              you to fill in.
            </div>
          )}
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

          <div className="mb-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={newIsOrg}
                onChange={(e) => setNewIsOrg(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
              />
              This is for a school or organization
            </label>
            {newIsOrg && (
              <>
                <input
                  type="text"
                  value={newSchool}
                  onChange={(e) => setNewSchool(e.target.value)}
                  placeholder="School / organization name"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
                />
                {isHouseSchool(newSchool) && (
                  <p className="mt-1 text-xs font-medium text-emerald-700">
                    ✓ Referral fees are waived for this school — no charge beyond the
                    gift, and no commission to anyone.
                  </p>
                )}
              </>
            )}
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
            const s = groupStats[g.id];
            return (
              <Link
                key={g.id}
                href={`/campfirelive/group/${g.id}`}
                className={`rounded-2xl border p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition ${
                  mine
                    ? "border-orange-200 bg-orange-50/50"
                    : "border-sky-200 bg-sky-50/60"
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-3xl">{g.avatar_emoji}</span>
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900">{g.name}</h3>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
                      <span>
                        {g.member_count} member{g.member_count === 1 ? "" : "s"}
                      </span>
                      {!mine && (
                        <span className="text-sky-700 font-medium">
                          · by {creatorNames[g.id] ?? "the host"}
                        </span>
                      )}
                      {s && s.invited > 0 && <span>· {s.invited} pending</span>}
                      {s && (s.active > 0 || s.recurring > 0) && (
                        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {s.active > 0 && <span>🔥 {s.active} active</span>}
                          {s.recurring > 0 && <span>🔁 {s.recurring} recurring</span>}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {g.description && (
                  <p className="text-sm text-slate-500 line-clamp-2">{g.description}</p>
                )}
                {/* Host-only digest controls, flipped right from the card. Buttons
                    (not checkboxes) so preventDefault stops the card navigation
                    without cancelling a native toggle — the optimistic state then
                    re-renders instantly. */}
                {mine && (
                  <div className="mt-3 space-y-1.5 border-t border-orange-100 pt-2.5">
                    {(
                      [
                        {
                          field: "notify_on_response" as const,
                          on: g.notify_on_response !== false,
                          emoji: "📬",
                          label: "Member digest",
                        },
                        {
                          field: "notify_host" as const,
                          on: g.notify_host !== false,
                          emoji: "🔔",
                          label: "Notify me (all activity)",
                        },
                      ]
                    ).map((t) => (
                      <button
                        key={t.field}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setGroupNotify(g.id, t.field, !t.on);
                        }}
                        className="flex w-full items-center gap-2 text-xs text-slate-600"
                      >
                        <span
                          className={`relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full transition ${
                            t.on ? "bg-orange-500" : "bg-slate-300"
                          }`}
                        >
                          <span
                            className={`inline-block h-3 w-3 transform rounded-full bg-white transition ${
                              t.on ? "translate-x-3.5" : "translate-x-0.5"
                            }`}
                          />
                        </span>
                        <span>
                          {t.emoji} {t.label}{" "}
                          <span className="text-slate-400">{t.on ? "on" : "off"}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
