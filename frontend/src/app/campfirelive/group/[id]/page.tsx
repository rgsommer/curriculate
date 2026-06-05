"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { useGroup, useRealtimeGroup, usePresence } from "@/lib/campfire/hooks";
import { ENGAGEMENT_TYPES } from "@/lib/campfire/types";

export default function GroupDetailPage() {
  const params = useParams();
  const groupId = params.id as string;
  const { user, session } = useAuth();
  const { group, members, engagements, streaks, invitations, loading, refresh } = useGroup(groupId);
  const { onlineUsers } = usePresence(groupId);
  const [showMembers, setShowMembers] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"active" | "revealed" | "all">("active");
  const [showEmailInvite, setShowEmailInvite] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [sending, setSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);

  // Real-time updates
  const handleUpdate = useCallback(() => {
    refresh();
  }, [refresh]);
  useRealtimeGroup(groupId, handleUpdate);

  const joinUrl = group
    ? `${typeof window !== "undefined" ? window.location.origin : "https://www.curriculate.net"}/campfirelive/join/${group.invite_code}`
    : "";

  const inviteMessage = group
    ? `${group.avatar_emoji} You're invited to "${group.name}" on Campfire!

Campfire is where our group plays together — polls, challenges, questions — with one twist: nobody sees anyone's answers until everyone has responded. Then it all unlocks at once. 🎉

👉 Tap to join: ${joinUrl}

How to jump in:
1. Tap the link above
2. Choose "Continue with Google" (takes about 5 seconds)
3. You're in! Answer the first question, then wait for the big reveal 🔥

(Already signed in? Just enter invite code ${group.invite_code}.)

See you around the campfire! 🏕️`
    : "";

  const copyInvite = () => {
    if (!group) return;
    navigator.clipboard.writeText(inviteMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyLink = () => {
    if (!group) return;
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sendEmailInvites = async () => {
    if (!group || !session) return;
    const emails = emailInput
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length === 0) {
      setInviteResult("Enter at least one email address.");
      return;
    }
    setSending(true);
    setInviteResult(null);
    try {
      const res = await fetch("/api/campfire/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ groupId, emails, origin: window.location.origin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteResult(data.error || "Couldn't send invites.");
      } else {
        setInviteResult(
          `✓ Sent ${data.sent} invite${data.sent === 1 ? "" : "s"}! They'll get an email — you can share the link below too and tell them to check their inbox.`
        );
        setEmailInput("");
        await refresh();
      }
    } catch {
      setInviteResult("Couldn't send invites. Try again.");
    }
    setSending(false);
  };

  // Nudge / revoke tracked invitations (creator actions).
  const inviteAction = async (path: string, emails?: string[]) => {
    if (!group || !session) return;
    try {
      await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ groupId, emails, origin: window.location.origin }),
      });
    } catch {
      /* surfaced via refreshed list */
    }
    await refresh();
  };
  const nudgeOne = (email: string) => inviteAction("/api/campfire/invite/nudge", [email]);
  const nudgeAllPending = () => inviteAction("/api/campfire/invite/nudge");
  const revokeOne = (email: string) => inviteAction("/api/campfire/invite/revoke", [email]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-slate-400 animate-pulse">Loading group...</div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">🤷</div>
        <p className="text-slate-500">Group not found.</p>
        <Link href="/campfirelive" className="text-orange-600 underline text-sm mt-2 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const myStreak = streaks.find((s) => s.user_id === user?.id);
  const activeEngagements = engagements.filter((e) => e.status === "active");
  const revealedEngagements = engagements.filter((e) => e.status === "revealed");
  const filteredEngagements =
    tab === "active" ? activeEngagements : tab === "revealed" ? revealedEngagements : engagements;

  return (
    <div>
      {/* Group Header */}
      <div className="mb-6">
        <Link href="/campfirelive" className="text-sm text-slate-500 hover:text-slate-700 mb-2 inline-block">
          ← All Groups
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-5xl">{group.avatar_emoji}</span>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">{group.name}</h1>
            {group.description && (
              <p className="text-sm text-slate-500">{group.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <div className="text-2xl font-bold text-slate-900">{members.length}</div>
          <div className="text-xs text-slate-500">Members</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <div className="text-2xl font-bold text-slate-900">{engagements.length}</div>
          <div className="text-xs text-slate-500">Engagements</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <div className="text-2xl font-bold text-orange-500">{myStreak?.current_streak ?? 0} 🔥</div>
          <div className="text-xs text-slate-500">Your Streak</div>
        </div>
      </div>

      {/* Invite + Members */}
      <div className="mb-6 rounded-2xl border border-orange-200 bg-orange-50/50 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={copyInvite}
            className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            {copied ? "✓ Copied — paste it anywhere!" : "📋 Copy invite"}
          </button>
          <button
            onClick={() => setShowEmailInvite((v) => !v)}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ✉️ Email invites
          </button>
          <button
            onClick={() => setShowMembers(!showMembers)}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {showMembers ? "Hide" : "Show"} Members
          </button>
        </div>

        {/* Email-invite form */}
        {showEmailInvite && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Invite by email — one or more, separated by commas or spaces. We&apos;ll
              send each person a join link and quick instructions.
            </label>
            <textarea
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              rows={3}
              placeholder="alex@example.com, jordan@example.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 outline-none resize-none"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={sendEmailInvites}
                disabled={sending || !emailInput.trim()}
                className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send email invites"}
              </button>
              {inviteResult && (
                <span
                  className={`text-xs font-medium ${
                    inviteResult.startsWith("✓") ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {inviteResult}
                </span>
              )}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Up to 50 at a time.</p>
          </div>
        )}

        <p className="mt-3 text-xs text-slate-500">
          Or copy a friendly invite with the join link + instructions — ready to
          paste into email, iMessage, or WhatsApp.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Or share directly:</span>
          <button
            onClick={copyLink}
            title="Copy join link"
            className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-slate-600 hover:bg-slate-50"
          >
            {joinUrl.replace(/^https?:\/\//, "")}
          </button>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500">
            code <span className="font-mono font-semibold text-slate-700">{group.invite_code}</span>
          </span>
        </div>

        <p className="mt-2 text-[11px] text-orange-700/80">
          💡 Tip: emailing invites lets you track who joined and nudge anyone who
          hasn&apos;t — a pasted link can&apos;t do that.
        </p>

        {/* Tracked invitations */}
        {invitations.length > 0 && (
          <div className="mt-3 border-t border-orange-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-600">
                Invitations ({invitations.filter((i) => i.status === "joined").length}/
                {invitations.filter((i) => i.status !== "revoked").length} joined)
              </span>
              {invitations.some((i) => i.status === "pending") && (
                <button
                  onClick={nudgeAllPending}
                  className="text-xs font-semibold text-orange-600 hover:underline"
                >
                  👋 Nudge all pending
                </button>
              )}
            </div>
            <div className="grid gap-1">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span
                    className={`truncate ${
                      inv.status === "revoked" ? "text-slate-400 line-through" : "text-slate-700"
                    }`}
                  >
                    {inv.email}
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {inv.status === "joined" && (
                      <span className="font-medium text-green-600">✓ joined</span>
                    )}
                    {inv.status === "revoked" && (
                      <span className="text-slate-400">revoked</span>
                    )}
                    {inv.status === "pending" && (
                      <>
                        <span className="text-amber-600">
                          pending
                          {inv.nudge_count > 0 ? ` · nudged ${inv.nudge_count}×` : ""}
                        </span>
                        <button
                          onClick={() => nudgeOne(inv.email)}
                          className="text-orange-600 hover:underline"
                        >
                          nudge
                        </button>
                        <button
                          onClick={() => revokeOne(inv.email)}
                          className="text-slate-400 hover:text-red-600 hover:underline"
                        >
                          revoke
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Members panel */}
      {showMembers && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid gap-2">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-3 py-1">
                <div className="relative">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-200 to-rose-200 flex items-center justify-center text-sm font-bold text-slate-700">
                    {m.profile?.display_name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  {onlineUsers.includes(m.user_id) && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white" />
                  )}
                </div>
                <div>
                  <span className="text-sm font-medium text-slate-900">
                    {m.profile?.display_name}
                    {m.user_id === user?.id && " (you)"}
                  </span>
                  {m.role === "admin" && (
                    <span className="ml-2 text-xs text-orange-600 font-semibold">Admin</span>
                  )}
                  {m.role === "spectator" && (
                    <span className="ml-2 text-xs text-slate-400">Spectator</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Engagement button */}
      <div className="mb-6">
        <Link
          href={`/campfirelive/group/${groupId}/engagement/new`}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"
        >
          + New Engagement
        </Link>
      </div>

      {/* Engagement Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 rounded-xl p-1 w-fit">
        {(["active", "revealed", "all"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              tab === t
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "active" ? `Active (${activeEngagements.length})` : t === "revealed" ? `Revealed (${revealedEngagements.length})` : `All (${engagements.length})`}
          </button>
        ))}
      </div>

      {/* Engagement List */}
      {filteredEngagements.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <div className="text-4xl mb-3">
            {tab === "active" ? "🔒" : tab === "revealed" ? "📭" : "🏕️"}
          </div>
          <p>
            {tab === "active"
              ? "No active engagements. Start one!"
              : tab === "revealed"
              ? "No revealed engagements yet."
              : "No engagements yet. Be the first to start one!"}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredEngagements.map((eng) => {
            const meta = ENGAGEMENT_TYPES[eng.type];
            const isSealed = eng.status === "active" && eng.reveal === "sealed";
            const isRevealed = eng.status === "revealed";
            const progress = eng.total_expected > 0
              ? Math.round((eng.response_count / eng.total_expected) * 100)
              : 0;

            return (
              <Link
                key={eng.id}
                href={`/campfirelive/group/${groupId}/engagement/${eng.id}`}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{meta?.icon ?? "📌"}</span>
                    <div>
                      <p className="text-xs font-semibold text-orange-600">
                        {eng.creator_id === user?.id
                          ? "Your"
                          : `${eng.creator?.display_name ?? "Someone"}'s`}{" "}
                        {meta?.label ?? eng.type}
                      </p>
                      <h3 className="font-bold text-slate-900">{eng.title}</h3>
                      <p className="text-sm text-slate-600 mt-0.5">
                        {eng.description?.trim() || meta?.hook}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        {new Date(eng.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {/* Status badge */}
                  {isSealed && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-800">
                      🔒 Sealed
                    </span>
                  )}
                  {isRevealed && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2.5 py-1 text-xs font-semibold text-green-700">
                      ✓ Revealed
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {eng.status === "active" && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>{eng.response_count}/{eng.total_expected} responded</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-orange-400 to-rose-400 transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Deadline */}
                {eng.deadline && eng.status === "active" && (
                  <p className="mt-2 text-xs text-slate-400">
                    Deadline:{" "}
                    {new Date(eng.deadline).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
