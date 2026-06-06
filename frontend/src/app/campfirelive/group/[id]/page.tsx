"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { useGroup, useRealtimeGroup, usePresence } from "@/lib/campfire/hooks";
import { ENGAGEMENT_TYPES, resolveTitle } from "@/lib/campfire/types";
import { parseInviteList } from "@/lib/campfire/parseInvites";

export default function GroupDetailPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;
  const { user, session } = useAuth();
  const { group, members, engagements, streaks, invitations, loading, refresh, renameGroup, setMyGroupName, leaveGroup, deleteGroup, setMemberRole, setMemberName } = useGroup(groupId);
  const { onlineUsers } = usePresence(groupId);
  const [showMembers, setShowMembers] = useState(false);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [editingMyName, setEditingMyName] = useState(false);
  const [myNameInput, setMyNameInput] = useState("");
  const [savingMyName, setSavingMyName] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberNameInput, setMemberNameInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"active" | "revealed" | "all">("active");
  const [showEmailInvite, setShowEmailInvite] = useState(false);
  const [inviteTarget, setInviteTarget] = useState(""); // "" = whole group, else engagement id
  const [emailInput, setEmailInput] = useState("");
  const [sending, setSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Real-time updates
  const handleUpdate = useCallback(() => {
    refresh();
  }, [refresh]);
  useRealtimeGroup(groupId, handleUpdate);

  const joinUrl = group
    ? `${typeof window !== "undefined" ? window.location.origin : "https://www.curriculate.net"}/campfirelive/join/${group.invite_code}`
    : "";

  // Live (launched, still-active) engagements — surfaced in the invite so people
  // know what they're joining into.
  const liveEngagements = engagements.filter(
    (e) => e.status === "active" && e.launched_at
  );
  const happeningBlock =
    liveEngagements.length > 0
      ? `\n\nHappening right now:\n${liveEngagements
          .map((e) => `• ${ENGAGEMENT_TYPES[e.type]?.icon ?? "🔥"} ${e.title}`)
          .join("\n")}`
      : "";

  const inviteMessage = group
    ? `${group.avatar_emoji} You're invited to "${group.name}" on Campfire!

Campfire is where our group plays together — polls, challenges, questions — with one twist: nobody sees anyone's answers until everyone has responded. Then it all unlocks at once. 🎉${happeningBlock}

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

  const showQrCode = async () => {
    if (!group) return;
    try {
      const QRCode = (await import("qrcode")).default;
      const url = await QRCode.toDataURL(joinUrl, {
        width: 360,
        margin: 2,
        color: { dark: "#0f172a", light: "#ffffff" },
      });
      setQrUrl(url);
    } catch {
      /* ignore */
    }
  };

  const sendEmailInvites = async () => {
    if (!group || !session) return;
    // Parse into {name, email} pairs — handles bare emails AND "Name <email@x.com>"
    // pasted from a contacts app. The name (when present) is kept and used to
    // greet the person in their invite email.
    const invites = parseInviteList(emailInput);
    if (invites.length === 0) {
      setInviteResult("Enter at least one email address (names are fine too).");
      return;
    }
    setSending(true);
    setInviteResult(null);
    try {
      if (inviteTarget) {
        // Invite to a SPECIFIC engagement — emails the deep-link straight into it.
        const res = await fetch("/api/campfire/engagement/invite", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            engagementId: inviteTarget,
            invites,
            origin: window.location.origin,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) setInviteResult(data.error || "Couldn't send.");
        else {
          setInviteResult(`✓ Emailed ${data.sent} — they'll land right in that engagement.`);
          setEmailInput("");
          await refresh();
        }
      } else {
        // Invite to the whole group (staged; emailed when an engagement is posted,
        // or right away if one's already live).
        const res = await fetch("/api/campfire/invite", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ groupId, invites, origin: window.location.origin, stage: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setInviteResult(data.error || "Couldn't add invites.");
        } else {
          setInviteResult(
            data.emailedNow > 0
              ? `✓ Added ${data.staged}. ${data.emailedNow} ${
                  data.emailedNow === 1 ? "was" : "were"
                } emailed the live engagement right away; the rest get a friendly invite the moment you post one.`
              : `✓ Added ${data.staged} to the invite list. They'll be emailed the moment you post an engagement.`
          );
          setEmailInput("");
          await refresh();
        }
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
  const markJoined = (email: string) => inviteAction("/api/campfire/invite/mark-joined", [email]);

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

  // Per-group names: a member's name in THIS group overrides their global one.
  const nameOf = (userId: string | null | undefined, fallback?: string | null) => {
    const m = members.find((mm) => mm.user_id === userId);
    return m?.display_name || m?.profile?.display_name || fallback || "Someone";
  };
  const myMembership = members.find((m) => m.user_id === user?.id);
  const myGroupName = myMembership?.display_name || "";

  const myStreak = streaks.find((s) => s.user_id === user?.id);
  const activeEngagements = engagements.filter((e) => e.status === "active");
  const revealedEngagements = engagements.filter((e) => e.status === "revealed");
  const filteredEngagements =
    tab === "active" ? activeEngagements : tab === "revealed" ? revealedEngagements : engagements;

  const isAdmin = members.find((m) => m.user_id === user?.id)?.role === "admin";
  // Engagements a regular member is allowed to invite people to.
  const memberInvitable = liveEngagements.filter((e) => e.allow_member_invites);
  const canEmailInvite = isAdmin || memberInvitable.length > 0;
  const partRates = engagements
    .filter((e) => e.total_expected > 0)
    .map((e) => e.response_count / e.total_expected);
  const avgParticipation = partRates.length
    ? Math.round((100 * partRates.reduce((a, b) => a + b, 0)) / partRates.length)
    : 0;
  const invitesJoined = invitations.filter((i) => i.status === "joined").length;
  const invitesTotal = invitations.filter((i) => i.status !== "revoked").length;
  const streakBoard = [...streaks]
    .sort((a, b) => b.current_streak - a.current_streak)
    .slice(0, 5);
  const nameFor = (uid: string) => nameOf(uid, "Member");

  // Your earned badges (client-computed from group activity).
  const myCurrentStreak = myStreak?.current_streak ?? 0;
  const topStreak = streaks.reduce((m, s) => Math.max(m, s.current_streak), 0);
  const iRecruited = invitations.some(
    (i) => i.invited_by === user?.id && i.status === "joined"
  );
  const myBadges = [
    myCurrentStreak >= 3 && { e: "🔥", t: "On a roll" },
    myCurrentStreak >= 7 && { e: "⚡", t: "Week streak" },
    myCurrentStreak > 0 && myCurrentStreak === topStreak && { e: "🏆", t: "Streak leader" },
    isAdmin && { e: "⭐", t: "Group host" },
    iRecruited && { e: "📣", t: "Recruiter" },
    engagements.length > 0 && avgParticipation === 100 && { e: "💯", t: "100% crew" },
  ].filter(Boolean) as { e: string; t: string }[];

  return (
    <div>
      {/* Group Header */}
      <div className="mb-6">
        <Link href="/campfirelive" className="text-sm text-slate-500 hover:text-slate-700 mb-2 inline-block">
          ← All Groups
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-5xl">{group.avatar_emoji}</span>
          <div className="flex-1">
            {renaming ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={60}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xl font-extrabold text-slate-900 outline-none focus:border-orange-500"
                />
                <button
                  disabled={savingName || !nameInput.trim()}
                  onClick={async () => {
                    setSavingName(true);
                    const { error } = await renameGroup(nameInput);
                    setSavingName(false);
                    if (error) {
                      alert("Couldn't rename: " + error);
                      return;
                    }
                    setRenaming(false);
                  }}
                  className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {savingName ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => setRenaming(false)}
                  className="rounded-full px-3 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-extrabold text-slate-900">{group.name}</h1>
                {isAdmin && (
                  <button
                    onClick={() => {
                      setNameInput(group.name);
                      setRenaming(true);
                    }}
                    title="Rename group"
                    className="text-slate-400 hover:text-orange-600"
                  >
                    ✏️
                  </button>
                )}
              </div>
            )}
            {group.description && (
              <p className="text-sm text-slate-500">{group.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Your name in THIS group (e.g. "Dad" in Family, "Mr. Sommer" in class) */}
      {myMembership && (
        <div className="mb-4 -mt-2 text-xs text-slate-500">
          {editingMyName ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={myNameInput}
                onChange={(e) => setMyNameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setEditingMyName(false)}
                placeholder="Your name in this group"
                maxLength={40}
                autoFocus
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm text-slate-800 outline-none focus:border-orange-500"
              />
              <button
                disabled={savingMyName}
                onClick={async () => {
                  setSavingMyName(true);
                  const { error } = await setMyGroupName(myNameInput);
                  setSavingMyName(false);
                  if (error) {
                    alert("Couldn't save: " + error);
                    return;
                  }
                  setEditingMyName(false);
                }}
                className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
              >
                {savingMyName ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditingMyName(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </span>
          ) : (
            <>
              You appear here as{" "}
              <span className="font-semibold text-slate-700">{nameOf(user?.id)}</span>
              <button
                onClick={() => {
                  setMyNameInput(myGroupName);
                  setEditingMyName(true);
                }}
                className="ml-1.5 text-orange-600 hover:underline"
              >
                change
              </button>
            </>
          )}
        </div>
      )}

      {/* Fresh-group onboarding — make the two next steps obvious */}
      {engagements.length === 0 && (
        <div className="mb-6 rounded-2xl border-2 border-orange-300 bg-gradient-to-br from-orange-50 to-rose-50 p-5">
          <div className="font-bold text-slate-900">
            🎉 Group created! Two quick steps to bring it to life:
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-orange-200 bg-white p-4">
              <div className="mb-1 text-sm font-bold text-slate-900">
                <span className="text-orange-600">1.</span> Invite your group
              </div>
              <p className="mb-2 text-xs text-slate-600">
                Share a link, QR, or email so people can join.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={copyInvite}
                  className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {copied ? "✓ Copied!" : "Copy invite"}
                </button>
                <button
                  onClick={showQrCode}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Show QR
                </button>
                <button
                  onClick={() => setShowEmailInvite(true)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Email
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-orange-200 bg-white p-4">
              <div className="mb-1 text-sm font-bold text-slate-900">
                <span className="text-orange-600">2.</span> Start your first engagement
              </div>
              <p className="mb-2 text-xs text-slate-600">
                Pose a question, poll, or challenge for the group to answer.
              </p>
              <Link
                href={`/campfirelive/group/${groupId}/engagement/new`}
                className="inline-block rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-3 py-1.5 text-xs font-semibold text-white"
              >
                + Start an engagement
              </Link>
            </div>
          </div>
        </div>
      )}

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

      {/* Your badges */}
      {myBadges.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Your badges:</span>
          {myBadges.map((b) => (
            <span
              key={b.t}
              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800"
            >
              {b.e} {b.t}
            </span>
          ))}
        </div>
      )}

      {/* Invite + Members (collapsible) */}
      <div className="mb-6 rounded-2xl border border-orange-200 bg-orange-50/50 p-4">
        <button
          onClick={() => {
            // Collapsing the panel also hides the members list it controls.
            if (showInvitePanel) setShowMembers(false);
            setShowInvitePanel((v) => !v);
          }}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="text-sm font-bold text-slate-800">
            👥 Invite &amp; members
            <span className="ml-2 font-normal text-slate-500">
              {members.length} in
              {invitesTotal > 0 ? ` · ${invitesJoined}/${invitesTotal} invited joined` : ""}
            </span>
          </span>
          <span className="flex-shrink-0 text-slate-400">
            {showInvitePanel ? "▲ Hide" : "▼ Manage"}
          </span>
        </button>

        {showInvitePanel && (
        <>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={copyInvite}
            title="Invite to this group — with a peek at all the active engagements"
            className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            {copied ? "✓ Copied — paste it anywhere!" : "📋 Copy Invite"}
          </button>
          {canEmailInvite && (
            <button
              onClick={() => {
                const opening = !showEmailInvite;
                // Members can only invite to specific engagements — default to one.
                if (opening && !isAdmin && !inviteTarget && memberInvitable[0]) {
                  setInviteTarget(memberInvitable[0].id);
                }
                setShowEmailInvite(opening);
              }}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ✉️ Add by email
            </button>
          )}
          <button
            onClick={showQrCode}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            📱 Show QR
          </button>
          <button
            onClick={() => setShowMembers(!showMembers)}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {showMembers ? "Hide" : "Show"} Members
          </button>
        </div>

        <p className="mt-2 text-[11px] text-slate-500">
          <span className="font-semibold">📋 Copy Invite</span> — invite to this group,
          with a peek at all the active engagements.
        </p>


        {/* Email-invite form — the one place to enter emails */}
        {showEmailInvite && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            {/* What is this invite about? */}
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Invite to
            </label>
            <select
              value={inviteTarget}
              onChange={(e) => setInviteTarget(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-orange-500 outline-none mb-2"
            >
              {/* Host can invite to the whole group; members only to engagements
                  whose creator turned on member invites. */}
              {isAdmin && (
                <option value="">📋 The whole group (sees all engagements)</option>
              )}
              {(isAdmin ? liveEngagements : memberInvitable).map((e) => (
                <option key={e.id} value={e.id}>
                  {ENGAGEMENT_TYPES[e.type]?.icon ?? "🔥"} {e.title}
                </option>
              ))}
            </select>

            <label className="block text-xs font-medium text-slate-600 mb-1">
              Email addresses — commas or spaces; paste from contacts too (e.g.{" "}
              <span className="font-mono">Alex Lee &lt;alex@example.com&gt;</span>).
              {inviteTarget
                ? " They get a link straight into that engagement (and can step back to the group for the rest)."
                : " They're added to the list and emailed the moment you post an engagement."}
            </label>
            <textarea
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              rows={3}
              placeholder="alex@example.com, Jordan Lee <jordan@example.com>"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 outline-none resize-none"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={sendEmailInvites}
                disabled={sending || !emailInput.trim()}
                className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {sending
                  ? inviteTarget
                    ? "Sending…"
                    : "Adding..."
                  : inviteTarget
                  ? "Send email invites"
                  : "Add to invite list"}
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
          💡 The invite list is emailed when you post an engagement (so the first
          email is something fun to do, not an empty group). For in-person joining,
          show the QR or share the link any time.
        </p>

        {/* Tracked invitations — host-only (shows invitee emails + controls) */}
        {isAdmin && invitations.length > 0 && (
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
            <div className="grid gap-1.5">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="rounded-lg bg-white/60 px-2.5 py-2 text-xs"
                >
                  {/* Top line: name + status badge — always visible, never truncated off */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`min-w-0 truncate font-medium ${
                        inv.status === "revoked"
                          ? "text-slate-400 line-through"
                          : "text-slate-800"
                      }`}
                    >
                      {inv.name || inv.email}
                    </span>
                    <span className="flex-shrink-0">
                      {inv.status === "joined" && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-700">
                          ✓ joined
                        </span>
                      )}
                      {inv.status === "revoked" && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-400">
                          revoked
                        </span>
                      )}
                      {inv.status === "pending" && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                          pending
                          {inv.nudge_count > 0 ? ` · ${inv.nudge_count}×` : ""}
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Email (only when a name is shown above) + who added them */}
                  <div className="mt-0.5 truncate text-slate-400">
                    {inv.name ? inv.email : null}
                    {inv.name && inv.invited_by ? " · " : ""}
                    {inv.invited_by
                      ? `added by ${
                          inv.invited_by === user?.id ? "you" : nameOf(inv.invited_by)
                        }`
                      : null}
                  </div>

                  {/* Actions — only for pending; wrap freely on a narrow screen */}
                  {inv.status === "pending" && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-medium">
                      <button
                        onClick={() => nudgeOne(inv.email)}
                        className="text-orange-600 hover:underline"
                      >
                        👋 nudge
                      </button>
                      <button
                        onClick={() => markJoined(inv.email)}
                        title="They already joined (e.g. under a different email)? Mark them in."
                        className="text-green-600 hover:underline"
                      >
                        ✓ mark joined
                      </button>
                      <button
                        onClick={() => revokeOne(inv.email)}
                        className="text-slate-400 hover:text-red-600 hover:underline"
                      >
                        ✕ revoke
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        </>
        )}
      </div>

      {/* Members panel */}
      {showMembers && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid gap-2">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between gap-3 py-1">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-200 to-rose-200 flex items-center justify-center text-sm font-bold text-slate-700">
                      {nameOf(m.user_id)[0]?.toUpperCase() ?? "?"}
                    </div>
                    {onlineUsers.includes(m.user_id) && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white" />
                    )}
                  </div>
                  <div className="min-w-0">
                    {editingMemberId === m.user_id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <input
                          type="text"
                          value={memberNameInput}
                          onChange={(e) => setMemberNameInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Escape" && setEditingMemberId(null)}
                          maxLength={40}
                          autoFocus
                          className="rounded-lg border border-slate-300 px-2 py-0.5 text-sm outline-none focus:border-orange-500"
                        />
                        <button
                          onClick={async () => {
                            const { error } = await setMemberName(m.user_id, memberNameInput);
                            if (error) {
                              alert("Couldn't rename: " + error);
                              return;
                            }
                            setEditingMemberId(null);
                          }}
                          className="text-xs font-semibold text-orange-600 hover:underline"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingMemberId(null)}
                          className="text-xs text-slate-400 hover:text-slate-600"
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <span className="text-sm font-medium text-slate-900">
                        {nameOf(m.user_id)}
                        {m.user_id === user?.id && " (you)"}
                        {isAdmin && (
                          <button
                            onClick={() => {
                              setMemberNameInput(
                                members.find((x) => x.user_id === m.user_id)?.display_name || ""
                              );
                              setEditingMemberId(m.user_id);
                            }}
                            title="Rename in this group"
                            className="ml-1.5 text-slate-300 hover:text-orange-600"
                          >
                            ✏️
                          </button>
                        )}
                      </span>
                    )}
                    {m.user_id === group.creator_id && (
                      <span className="ml-2 text-xs text-orange-600 font-semibold">Host</span>
                    )}
                    {m.role === "spectator" && (
                      <span className="ml-2 text-xs text-slate-400">Spectator</span>
                    )}
                  </div>
                </div>
                {/* Admins can promote/demote (creator/host is locked as admin) */}
                {isAdmin && m.user_id !== group.creator_id ? (
                  <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={m.role === "admin"}
                      onChange={(e) =>
                        setMemberRole(m.user_id, e.target.checked ? "admin" : "member")
                      }
                      className="w-3.5 h-3.5 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                    />
                    Admin
                  </label>
                ) : (
                  m.role === "admin" &&
                  m.user_id !== group.creator_id && (
                    <span className="text-xs text-orange-600 font-semibold flex-shrink-0">
                      Admin
                    </span>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Host analytics (admins only) */}
      {isAdmin && (
        <div className="mb-6">
          <button
            onClick={() => setShowAnalytics((v) => !v)}
            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            📊 Host analytics {showAnalytics ? "▲" : "▼"}
          </button>
          {showAnalytics && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="rounded-xl bg-slate-50 p-3 text-center">
                  <div className="text-xl font-bold text-slate-900">{avgParticipation}%</div>
                  <div className="text-xs text-slate-500">Avg participation</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 text-center">
                  <div className="text-xl font-bold text-slate-900">{activeEngagements.length}</div>
                  <div className="text-xs text-slate-500">Active</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 text-center">
                  <div className="text-xl font-bold text-slate-900">{revealedEngagements.length}</div>
                  <div className="text-xs text-slate-500">Revealed</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 text-center">
                  <div className="text-xl font-bold text-slate-900">
                    {invitesTotal > 0 ? `${invitesJoined}/${invitesTotal}` : "—"}
                  </div>
                  <div className="text-xs text-slate-500">Invites joined</div>
                </div>
              </div>
              {streakBoard.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 mb-2">
                    🔥 Streak leaderboard
                  </div>
                  <div className="grid gap-1">
                    {streakBoard.map((s, i) => (
                      <div key={s.user_id} className="flex items-center justify-between text-sm">
                        <span className="text-slate-700">
                          {i + 1}. {nameFor(s.user_id)}
                        </span>
                        <span className="font-semibold text-orange-600">
                          {s.current_streak} 🔥
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Start-your-own promo — shown once the group is rolling (fresh groups get
          the onboarding card above instead) */}
      {engagements.length > 0 && (
        <div className="mb-6 rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50/60 p-5 text-center">
          <div className="text-2xl mb-1">🔥</div>
          <div className="font-bold text-slate-900">
            {activeEngagements.length === 0
              ? "Be the first to spark something"
              : "Your turn to spark something"}
          </div>
          <p className="mt-0.5 mb-3 text-sm text-slate-600">
            Anyone can start an engagement — a question, a challenge, a check-in.
            Nobody sees the answers until everyone&apos;s in.
          </p>
          <Link
            href={`/campfirelive/group/${groupId}/engagement/new`}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            + Start an engagement
          </Link>
        </div>
      )}

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
            const isDraft = !eng.launched_at; // creator-only until launched (RLS hides from others)
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
                          : `${nameOf(eng.creator_id, eng.creator?.display_name)}'s`}{" "}
                        {meta?.label ?? eng.type}
                      </p>
                      <h3 className="font-bold text-slate-900">
                        {resolveTitle(eng.title, eng.birth_year, eng.deadline)}
                      </h3>
                      <p className="text-sm text-slate-600 mt-0.5">
                        {eng.description?.trim() || meta?.hook}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        {new Date(eng.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {/* Status badge */}
                  {isDraft && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 border border-orange-300 px-2.5 py-1 text-xs font-semibold text-orange-800">
                      ✏️ Draft · tap to launch
                    </span>
                  )}
                  {!isDraft && isSealed && (
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

      {/* QR join code — show on a screen for others to scan */}
      {/* Leave group — any member except the creator (who owns it) */}
      {group.creator_id !== user?.id &&
        members.some((m) => m.user_id === user?.id) && (
          <div className="mt-8 text-center">
            <button
              onClick={async () => {
                if (
                  !window.confirm(
                    `Leave "${group.name}"? You'll stop seeing its engagements. You can rejoin later with the invite link.`
                  )
                )
                  return;
                const { error } = await leaveGroup();
                if (error) {
                  alert("Couldn't leave: " + error);
                  return;
                }
                router.push("/campfirelive");
              }}
              className="text-xs text-slate-400 underline hover:text-red-600"
            >
              Leave this group
            </button>
          </div>
        )}

      {/* Delete group — creator (owner) only */}
      {group.creator_id === user?.id && (
        <div className="mt-8 text-center">
          <button
            onClick={async () => {
              if (
                !window.confirm(
                  `Delete "${group.name}"? This permanently removes the group and ALL its engagements, responses, and members. This can't be undone.`
                )
              )
                return;
              const { error } = await deleteGroup();
              if (error) {
                alert("Couldn't delete: " + error);
                return;
              }
              router.push("/campfirelive");
            }}
            className="text-xs text-slate-400 underline hover:text-red-600"
          >
            Delete this group
          </button>
        </div>
      )}

      {qrUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setQrUrl(null)}
        >
          <div
            className="rounded-3xl bg-white p-6 text-center shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-lg font-bold text-slate-900">
              {group.avatar_emoji} {group.name}
            </div>
            <p className="mb-3 text-sm text-slate-500">Scan to join the group</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrUrl} alt="Join QR code" width={300} height={300} className="mx-auto rounded-xl" />
            <p className="mt-3 break-all font-mono text-xs text-slate-500">
              {joinUrl.replace(/^https?:\/\//, "")}
            </p>
            <button
              onClick={() => setQrUrl(null)}
              className="mt-4 rounded-full bg-slate-100 px-6 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
