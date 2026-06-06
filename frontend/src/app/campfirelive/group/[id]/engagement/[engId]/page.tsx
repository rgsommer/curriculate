"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { useEngagement, useRealtimeEngagement } from "@/lib/campfire/hooks";
import { ENGAGEMENT_TYPES } from "@/lib/campfire/types";
import { supabase } from "@/lib/campfire/supabase";
import { hasProfanity } from "@/lib/campfire/profanity";

// ── Canvas helpers for the shareable results card ──
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(/\s+/);
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

export default function EngagementDetailPage() {
  const params = useParams();
  const groupId = params.id as string;
  const engagementId = params.engId as string;
  const router = useRouter();
  const { user, session } = useAuth();

  const {
    engagement,
    responses,
    reactions,
    comments,
    ratings,
    myResponse,
    responseCount,
    lieGuesses,
    lieAnswers,
    revealAnswer,
    loading,
    submitResponse,
    submitTwoTruths,
    submitLieGuess,
    revealLiesNow,
    setRevealAnswer,
    addReaction,
    addRating,
    addComment,
    sendNudge,
    revealNow,
    unrevealEngagement,
    setHoldUntilDeadline,
    setWaitForAllInvited,
    launchEngagement,
    deleteEngagement,
    removeResponse,
    reportResponse,
    refresh,
  } = useEngagement(engagementId);

  // Real-time: auto-refresh when anything changes
  const handleRealtimeUpdate = useCallback(() => {
    refresh();
  }, [refresh]);
  useRealtimeEngagement(engagementId, handleRealtimeUpdate);

  // Invite context for a truer progress picture (host-only — RLS limits reads
  // to the group admin, so non-admins simply get zeros and see nothing extra).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("campfire_invitations")
        .select("status")
        .eq("group_id", groupId);
      // Member-safe pending count (works for everyone, returns a number only).
      const { data: pc } = await supabase.rpc("pending_invite_count", { _gid: groupId });
      // Group name + code for the per-engagement invite link (members can read).
      const { data: g } = await supabase
        .from("groups")
        .select("name, invite_code")
        .eq("id", groupId)
        .maybeSingle();
      if (!cancelled) {
        if (data) {
          setInviteStats({
            joined: data.filter((r) => r.status === "joined").length,
            pending: data.filter((r) => r.status === "pending").length,
          });
        }
        setPendingCount((pc as number) ?? 0);
        if (g) setGroupInfo(g as { name: string; invite_code: string });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, responseCount]);

  // Local UI state
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Two Truths & a Lie entry state
  const [ttStatements, setTtStatements] = useState(["", "", ""]);
  const [ttLie, setTtLie] = useState<number | null>(null);
  // "Most Likely To…" — the group roster (candidates) and this user's votes
  const [roster, setRoster] = useState<{ user_id: string; name: string }[]>([]);
  const [mlVotes, setMlVotes] = useState<Record<number, string>>({});
  // Accountability: 1–5 self-rating per question + an optional note to the group
  const [acRatings, setAcRatings] = useState<Record<number, number>>({});
  const [acNote, setAcNote] = useState("");
  // Scavenger Hunt: per-item { text, photo } + which item is uploading
  const [shItems, setShItems] = useState<Record<number, { text?: string; photo?: string }>>({});
  const [shUploading, setShUploading] = useState<number | null>(null);
  // Group roster with per-group names ("Dad" / "Mr. Sommer") — used as the
  // Most Likely candidate list AND to resolve everyone's name on this page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("group_members")
        .select("user_id, display_name, profile:profiles(display_name)")
        .eq("group_id", groupId);
      if (!cancelled && data) {
        const list = (
          data as {
            user_id: string;
            display_name: string | null;
            profile: { display_name: string } | { display_name: string }[] | null;
          }[]
        ).map((m) => {
          const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
          return { user_id: m.user_id, name: m.display_name || p?.display_name || "Someone" };
        });
        setRoster(list);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);
  const [commentText, setCommentText] = useState("");
  const [showRevealAnimation, setShowRevealAnimation] = useState(false);
  const [justRevealed, setJustRevealed] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  // Media upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Creator edit state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editRecurrence, setEditRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [editAllowMemberInvites, setEditAllowMemberInvites] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [justLaunched, setJustLaunched] = useState(false);
  // Invite context for the host: how many were invited but haven't joined yet.
  // (RLS lets only the group admin read invitations, so non-admins just get 0.)
  const [inviteStats, setInviteStats] = useState({ joined: 0, pending: 0 });
  const [pendingCount, setPendingCount] = useState(0);
  const [groupInfo, setGroupInfo] = useState<{ name: string; invite_code: string } | null>(null);
  const [sharedEng, setSharedEng] = useState(false);
  const [nudgeMsg, setNudgeMsg] = useState<string | null>(null);
  // "Guess who" game for blind engagements: responseId -> guessed name
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());

  // Detect reveal transition for animation
  useEffect(() => {
    if (prevStatusRef.current === "active" && engagement?.status === "revealed") {
      setShowRevealAnimation(true);
      setJustRevealed(true);
      setTimeout(() => setShowRevealAnimation(false), 3000);
      // Email the results to members who have an email (guests have none, so
      // they're skipped). Idempotent server-side, so multiple viewers firing
      // this only sends once.
      if (session) {
        fetch("/api/campfire/engagement/notify-reveal", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ engagementId, origin: window.location.origin }),
        }).catch(() => {});
      }
    }
    prevStatusRef.current = engagement?.status ?? null;
  }, [engagement?.status, session, engagementId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-slate-400 animate-pulse">Loading engagement...</div>
      </div>
    );
  }

  if (!engagement) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Engagement not found.</p>
        <Link href={`/campfirelive/group/${groupId}`} className="text-orange-600 underline text-sm mt-2 inline-block">
          Back to group
        </Link>
      </div>
    );
  }

  const meta = ENGAGEMENT_TYPES[engagement.type];
  const isSealed = engagement.reveal === "sealed" && engagement.status === "active";
  const isRevealed = engagement.status === "revealed";
  // Live modes show responses as they arrive; all_at_once waits for the creator.
  const liveMode =
    engagement.reveal === "as_they_come" || engagement.reveal === "instant";
  const showResults = isRevealed || liveMode;
  const awaitingCreatorReveal =
    engagement.reveal === "all_at_once" && engagement.status === "active";
  const hasResponded = !!myResponse;
  // The count the reveal actually waits on. With "wait for all invited" the bar
  // includes people invited but not yet joined (they must join + respond too).
  const waitAll = !!engagement.wait_for_all_invited;
  const displayExpected = engagement.total_expected + (waitAll ? pendingCount : 0);
  const allIn = responseCount >= displayExpected;
  const isCreator = engagement.creator_id === user?.id;
  const isDraft = !engagement.launched_at;
  // Resolve a member's per-group name (falls back to their global/profile name).
  const memberNameOf = (userId: string | null | undefined, fallback?: string | null) =>
    roster.find((m) => m.user_id === userId)?.name || fallback || "Someone";
  const pollOptions = (engagement.config?.options as string[]) ?? [];
  const canEdit = isCreator && engagement.status === "active";

  // Human description of WHEN this will reveal — keeps the waiting copy honest.
  const deadlineStr = engagement.deadline
    ? new Date(engagement.deadline).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const revealRule = engagement.hold_until_deadline && deadlineStr
    ? `Sealed until the deadline (${deadlineStr}) — it won't open early even if everyone answers.`
    : waitAll
    ? "Reveals once everyone invited has joined and responded."
    : "Reveals the moment everyone who's joined has responded.";

  // ── Ratings / winner (non-poll, after reveal) ──
  const ratingFor = (responseId: string) => {
    const scores = ratings.filter((rt) => rt.response_id === responseId);
    return {
      avg: scores.length ? scores.reduce((a, b) => a + b.score, 0) / scores.length : 0,
      count: scores.length,
    };
  };
  const myRatingFor = (responseId: string) =>
    ratings.find((rt) => rt.response_id === responseId && rt.rater_id === user?.id)?.score ?? 0;
  // Winner = highest average rating (needs ≥1 rating); ties → earliest response.
  let winnerResponseId: string | null = null;
  let bestAvg = -1;
  for (const r of responses) {
    const { avg, count } = ratingFor(r.id);
    if (count > 0 && avg > bestAvg) {
      bestAvg = avg;
      winnerResponseId = r.id;
    }
  }
  const winnerUserId = winnerResponseId
    ? responses.find((r) => r.id === winnerResponseId)?.user_id ?? null
    : null;
  const iWon = isRevealed && !!winnerUserId && winnerUserId === user?.id;

  // ── Creator: edit the prompt ──

  const startEdit = () => {
    setEditTitle(engagement.title);
    setEditDesc(engagement.description ?? "");
    setEditRecurrence(
      (engagement.recurrence_rule as "daily" | "weekly" | "monthly" | null) ?? "none"
    );
    setEditAllowMemberInvites(!!engagement.allow_member_invites);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editTitle.trim()) return;
    setSavingEdit(true);
    const { error } = await supabase
      .from("engagements")
      .update({
        title: editTitle.trim(),
        description: editDesc.trim() || null,
        recurrence_rule: editRecurrence === "none" ? null : editRecurrence,
        allow_member_invites: editAllowMemberInvites,
      })
      .eq("id", engagementId);
    setSavingEdit(false);
    if (error) {
      alert("Couldn't save your changes: " + error.message);
      return;
    }
    setEditing(false);
    refresh();
  };

  // Email a reminder to everyone who hasn't responded yet.
  const nudgeStragglers = async () => {
    if (!session) return;
    setNudgeMsg("Sending…");
    try {
      const res = await fetch("/api/campfire/engagement/nudge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ engagementId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setNudgeMsg(data.error || "Couldn't send nudges.");
      else
        setNudgeMsg(
          data.nudged > 0
            ? `✓ Nudged ${data.nudged} ${data.nudged === 1 ? "person" : "people"}`
            : "Everyone has already responded!"
        );
    } catch {
      setNudgeMsg("Couldn't send nudges.");
    }
  };

  // Build & download a shareable PNG of the revealed results.
  const shareResults = () => {
    const W = 1080;
    const H = 1350;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#f97316");
    g.addColorStop(1, "#e11d48");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "bold 46px system-ui, -apple-system, sans-serif";
    ctx.fillText("🔥 Campfire", 80, 80);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 66px system-ui, -apple-system, sans-serif";
    let y = wrapText(ctx, engagement.title, 80, 190, W - 160, 80) + 40;

    if (engagement.type === "poll") {
      const votes: Record<string, number> = {};
      pollOptions.forEach((o) => (votes[o] = 0));
      responses.forEach((r) => {
        const o = (r.content as Record<string, unknown>)?.option as string;
        if (o) votes[o] = (votes[o] ?? 0) + 1;
      });
      const total = responses.length || 1;
      pollOptions.forEach((o) => {
        const pct = Math.round(((votes[o] ?? 0) / total) * 100);
        ctx.font = "bold 42px system-ui, -apple-system, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.fillText(o.length > 24 ? o.slice(0, 23) + "…" : o, 80, y);
        ctx.textAlign = "right";
        ctx.fillText(`${pct}%`, W - 80, y);
        ctx.textAlign = "left";
        y += 60;
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        roundRectPath(ctx, 80, y, W - 160, 36, 18);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        roundRectPath(ctx, 80, y, (W - 160) * (pct / 100), 36, 18);
        ctx.fill();
        y += 84;
      });
    } else {
      ctx.font = "bold 50px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`${responses.length} responses revealed`, 80, y);
      y += 84;
      if (winnerUserId) {
        const wn = responses.find((r) => r.user_id === winnerUserId)?.profile?.display_name;
        if (wn) ctx.fillText(`🏆 ${engagement.is_blind ? "Anonymous" : wn}`, 80, y);
      }
    }

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "36px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("curriculate.net/campfire", 80, H - 90);

    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campfire-${engagementId.slice(0, 8)}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  // Creator launches the draft — makes it live for the group, then (optionally) emails.
  // Copy an invite that's about THIS engagement, with a join link that drops the
  // person straight into it after they join the group.
  const shareEngagement = async () => {
    if (!engagement || !groupInfo) return;
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://www.curriculate.net";
    const url = `${origin}/campfirelive/join/${groupInfo.invite_code}?e=${engagement.id}`;
    const blurb = engagement.description?.trim() || meta?.hook || "";
    const msg = `You're invited to "${engagement.title}" in ${groupInfo.name} on Campfire! 🔥${
      blurb ? `\n\n${blurb}` : ""
    }\n\nTap to join & jump straight in:\n${url}\n\n(Already on Campfire? Use code ${groupInfo.invite_code}.)`;
    try {
      await navigator.clipboard.writeText(msg);
      setSharedEng(true);
      setTimeout(() => setSharedEng(false), 2500);
    } catch {
      alert(msg); // clipboard blocked — show it so they can copy manually
    }
  };

  const launch = async () => {
    if (launching) return;
    setLaunching(true);
    const { error } = await launchEngagement();
    if (error) {
      alert("Couldn't launch: " + error);
      setLaunching(false);
      return;
    }
    setJustLaunched(true);
    // Launching always notifies the group (+ pending invitees) so nobody is left
    // out when a member posts. Non-fatal if the email send hiccups.
    if (session) {
      try {
        await fetch("/api/campfire/engagement/notify-new", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            engagementId: engagement.id,
            origin: window.location.origin,
          }),
        });
      } catch {
        /* non-fatal: the engagement is live regardless */
      }
    }
    setLaunching(false);
  };

  // Creator cancels (deletes) the engagement — it vanishes for everyone (live).
  const cancelEngagement = async () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Cancel this engagement? It will be removed for everyone — this can't be undone."
      )
    )
      return;
    const { error } = await deleteEngagement();
    if (error) {
      alert("Couldn't cancel: " + error);
      return;
    }
    router.push(`/campfirelive/group/${groupId}`);
  };

  // ── Submit handlers ──

  const handlePollSubmit = async () => {
    if (!selectedOption) return;
    setSubmitting(true);
    await submitResponse({ option: selectedOption });
    setSubmitting(false);
  };

  const handleTextSubmit = async () => {
    if (!textInput.trim()) return;
    if (hasProfanity(textInput)) {
      alert("Let's keep it kind — please reword your response.");
      return;
    }
    setSubmitting(true);
    await submitResponse({ text: textInput.trim() });
    setSubmitting(false);
    setTextInput("");
  };

  const handleTwoTruthsSubmit = async () => {
    const cleaned = ttStatements.map((s) => s.trim());
    if (cleaned.some((s) => !s)) {
      alert("Fill in all three statements.");
      return;
    }
    if (ttLie === null) {
      alert("Tap the circle next to the statement that's the lie.");
      return;
    }
    if (cleaned.some((s) => hasProfanity(s))) {
      alert("Let's keep it kind — please reword.");
      return;
    }
    setSubmitting(true);
    const { error: ttErr } = await submitTwoTruths(cleaned, ttLie);
    setSubmitting(false);
    if (ttErr) alert("Couldn't submit: " + ttErr);
  };

  const handleMostLikelySubmit = async () => {
    const anyVote = Object.values(mlVotes).some(Boolean);
    if (!anyVote) {
      alert("Vote for at least one award.");
      return;
    }
    // Drop any blank picks before saving.
    const answers: Record<string, string> = {};
    Object.entries(mlVotes).forEach(([k, v]) => {
      if (v && v.trim()) answers[k] = v.trim();
    });
    setSubmitting(true);
    const { error: mlErr } = await submitResponse({ answers });
    setSubmitting(false);
    if (mlErr) alert("Couldn't submit: " + mlErr);
  };

  const handleAccountabilitySubmit = async () => {
    const qs = (engagement.config?.questions as string[]) ?? [];
    if (qs.some((_, i) => !acRatings[i])) {
      alert("Give each question a rating (1–5).");
      return;
    }
    const note = acNote.trim();
    if (note && hasProfanity(note)) {
      alert("Let's keep it kind — please reword your note.");
      return;
    }
    const answers: Record<string, number> = {};
    qs.forEach((_, i) => {
      answers[i] = acRatings[i];
    });
    setSubmitting(true);
    const { error: acErr } = await submitResponse({ answers, note: note || undefined });
    setSubmitting(false);
    if (acErr) alert("Couldn't submit: " + acErr);
  };

  const handleScavengerUpload = async (i: number, file: File | undefined) => {
    if (!file || !user) return;
    setShUploading(i);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/${engagementId}/${i}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("campfire-media").upload(path, file);
    if (upErr) {
      alert("Upload failed: " + upErr.message);
      setShUploading(null);
      return;
    }
    const { data } = supabase.storage.from("campfire-media").getPublicUrl(path);
    setShItems((prev) => ({ ...prev, [i]: { ...prev[i], photo: data.publicUrl } }));
    setShUploading(null);
  };

  const handleScavengerSubmit = async () => {
    const items = (engagement.config?.questions as string[]) ?? [];
    const answers: Record<string, { text?: string; photo?: string }> = {};
    for (let i = 0; i < items.length; i++) {
      const it = shItems[i];
      const text = it?.text?.trim();
      if (text && hasProfanity(text)) {
        alert("Let's keep it kind — please reword.");
        return;
      }
      if (text || it?.photo) {
        answers[i] = { ...(text ? { text } : {}), ...(it?.photo ? { photo: it.photo } : {}) };
      }
    }
    if (Object.keys(answers).length === 0) {
      alert("Answer at least one item (a photo or some text).");
      return;
    }
    setSubmitting(true);
    const { error: shErr } = await submitResponse({ answers });
    setSubmitting(false);
    if (shErr) alert("Couldn't submit: " + shErr);
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);

    const fileExt = file.name.split(".").pop();
    const filePath = `${user.id}/${engagementId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("campfire-media")
      .upload(filePath, file);

    if (uploadError) {
      alert("Upload failed: " + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from("campfire-media")
      .getPublicUrl(filePath);

    await submitResponse({
      media_url: urlData.publicUrl,
      media_type: file.type.startsWith("video") ? "video" : "photo",
      caption: textInput.trim() || undefined,
    });
    setUploading(false);
    setTextInput("");
  };

  const handleCommentSubmit = async () => {
    if (!commentText.trim()) return;
    if (hasProfanity(commentText)) {
      alert("Let's keep it kind — please reword your comment.");
      return;
    }
    await addComment(commentText.trim());
    setCommentText("");
  };

  // ── Render helpers ──

  const renderResponseForm = () => {
    if (hasResponded) return null;

    switch (engagement.type) {
      case "scavenger_hunt": {
        const items = (engagement.config?.questions as string[]) ?? [];
        return (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Answer each with a photo or a typed answer — any order. Lock in when you&apos;re
              done.
            </p>
            {items.map((item, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3">
                <div className="text-sm font-medium text-slate-700 mb-1.5">
                  {i + 1}. {item}
                </div>
                <textarea
                  value={shItems[i]?.text ?? ""}
                  onChange={(e) =>
                    setShItems({ ...shItems, [i]: { ...shItems[i], text: e.target.value } })
                  }
                  rows={2}
                  placeholder="Type your answer…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-lime-500 outline-none resize-none"
                />
                <div className="mt-1.5 flex items-center gap-2">
                  <label className="cursor-pointer rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    {shUploading === i
                      ? "Uploading…"
                      : shItems[i]?.photo
                      ? "📷 Replace photo"
                      : "📷 Add photo"}
                    <input
                      type="file"
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={(e) => handleScavengerUpload(i, e.target.files?.[0])}
                    />
                  </label>
                  {shItems[i]?.photo && (
                    <button
                      type="button"
                      onClick={() =>
                        setShItems((prev) => ({ ...prev, [i]: { ...prev[i], photo: undefined } }))
                      }
                      className="text-xs text-slate-400 hover:text-red-500"
                    >
                      remove
                    </button>
                  )}
                </div>
                {shItems[i]?.photo && (
                  <img
                    src={shItems[i].photo}
                    alt=""
                    className="mt-2 max-h-32 rounded-lg object-cover"
                  />
                )}
              </div>
            ))}
            <button
              onClick={handleScavengerSubmit}
              disabled={submitting || shUploading !== null}
              className="w-full rounded-xl bg-gradient-to-r from-lime-500 to-green-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Lock In My Hunt"}
            </button>
          </div>
        );
      }

      case "accountability": {
        const qs = (engagement.config?.questions as string[]) ?? [];
        return (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Rate yourself honestly, 1 (struggled) to 5 (strong).
            </p>
            {qs.map((q, i) => (
              <div key={i}>
                <div className="text-sm font-medium text-slate-700 mb-1.5">
                  🙏 {q}
                </div>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAcRatings({ ...acRatings, [i]: n })}
                      className={`flex-1 rounded-lg border py-2 text-sm font-semibold transition ${
                        acRatings[i] === n
                          ? "border-violet-500 bg-violet-500 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-violet-300"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Share with the group{" "}
                <span className="text-slate-400">(optional)</span>
              </label>
              <textarea
                value={acNote}
                onChange={(e) => setAcNote(e.target.value)}
                rows={3}
                placeholder="An encouragement, a verse, a prayer request… shown to everyone at the reveal."
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-violet-500 outline-none resize-none"
              />
            </div>
            <button
              onClick={handleAccountabilitySubmit}
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Lock In My Check-in"}
            </button>
          </div>
        );
      }

      case "most_likely": {
        const qs = (engagement.config?.questions as string[]) ?? [];
        return (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Vote a group-mate for each award. Sealed until the reveal.
            </p>
            {qs.map((q, i) => (
              <div key={i}>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  🏆 {q}
                </label>
                <input
                  type="text"
                  list={`roster-${i}`}
                  value={mlVotes[i] ?? ""}
                  onChange={(e) => setMlVotes({ ...mlVotes, [i]: e.target.value })}
                  placeholder="Type a name…"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white focus:border-orange-500 outline-none"
                />
                <datalist id={`roster-${i}`}>
                  {roster.map((m) => (
                    <option key={m.user_id} value={m.name} />
                  ))}
                </datalist>
              </div>
            ))}
            <button
              onClick={handleMostLikelySubmit}
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Lock In My Votes"}
            </button>
          </div>
        );
      }

      case "baby_reveal":
        return (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              Lock in your guess — it stays sealed until the reveal date.
            </p>
            {pollOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setSelectedOption(opt)}
                className={`w-full text-left rounded-xl border p-3 text-sm transition ${
                  selectedOption === opt
                    ? "border-sky-500 bg-sky-50 font-semibold"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                {opt}
              </button>
            ))}
            <button
              onClick={handlePollSubmit}
              disabled={!selectedOption || submitting}
              className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🍼 Lock In My Guess"}
            </button>
          </div>
        );

      case "two_truths":
        return (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Write three statements about yourself — two true, one a lie. Tap the
              circle on the one that&apos;s the lie. Everyone guesses it later.
            </p>
            {ttStatements.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTtLie(i)}
                  title="Mark this one as the lie"
                  className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs ${
                    ttLie === i
                      ? "border-rose-500 bg-rose-500 text-white"
                      : "border-slate-300 text-transparent hover:border-rose-300"
                  }`}
                >
                  {ttLie === i ? "🤥" : ""}
                </button>
                <input
                  type="text"
                  value={s}
                  onChange={(e) => {
                    const next = [...ttStatements];
                    next[i] = e.target.value;
                    setTtStatements(next);
                  }}
                  placeholder={`Statement ${i + 1}`}
                  className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none"
                />
              </div>
            ))}
            <p className="text-xs text-slate-400">
              {ttLie === null ? "Tap a circle to mark your lie 🤥" : `Statement ${ttLie + 1} is your lie.`}
            </p>
            <button
              onClick={handleTwoTruthsSubmit}
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Lock In My Three"}
            </button>
          </div>
        );

      case "poll":
        return (
          <div className="space-y-2">
            {pollOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setSelectedOption(opt)}
                className={`w-full text-left rounded-xl border p-3 text-sm transition ${
                  selectedOption === opt
                    ? "border-orange-500 bg-orange-50 font-semibold"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                {opt}
              </button>
            ))}
            <button
              onClick={handlePollSubmit}
              disabled={!selectedOption || submitting}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Lock In My Vote"}
            </button>
          </div>
        );

      case "challenge":
      case "photo_pose":
        return (
          <div className="space-y-3">
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Add a caption, recipe, or details (optional)"
              rows={3}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none resize-none"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleMediaUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "📸 Upload Photo or Video"}
            </button>
          </div>
        );

      case "voice_response":
        return (
          <div className="text-center py-6">
            <div className="text-4xl mb-3">🎤</div>
            <p className="text-sm text-slate-500 mb-3">
              Voice recording requires native app. For now, submit a text response.
            </p>
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Type your response..."
              rows={3}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none resize-none mb-3"
            />
            <button
              onClick={handleTextSubmit}
              disabled={!textInput.trim() || submitting}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Response"}
            </button>
          </div>
        );

      default:
        // Generic text response (share, accountability, advice, truth_or_dare, etc.)
        return (
          <div className="space-y-3">
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Type your response..."
              rows={4}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none resize-none"
            />
            <button
              onClick={handleTextSubmit}
              disabled={!textInput.trim() || submitting}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Submit Response"}
            </button>
          </div>
        );
    }
  };

  const renderPollResults = () => {
    if (!showResults || engagement.type !== "poll") return null;

    const votes: Record<string, number> = {};
    pollOptions.forEach((o) => (votes[o] = 0));
    responses.forEach((r) => {
      const opt = r.content?.option as string;
      if (opt) votes[opt] = (votes[opt] ?? 0) + 1;
    });
    const total = responses.length || 1;

    return (
      <div className="space-y-2">
        {pollOptions.map((opt) => {
          const count = votes[opt] ?? 0;
          const pct = Math.round((count / total) * 100);
          return (
            <div key={opt} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="relative px-4 py-3">
                <div
                  className="absolute inset-0 bg-gradient-to-r from-orange-100 to-rose-100 transition-all"
                  style={{ width: `${pct}%` }}
                />
                <div className="relative flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-900">{opt}</span>
                  <span className="text-sm font-bold text-slate-700">{pct}% ({count})</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderScavengerResults = () => {
    if (!showResults || engagement.type !== "scavenger_hunt") return null;
    const items = (engagement.config?.questions as string[]) ?? [];
    return (
      <div className="space-y-3">
        {items.map((item, i) => {
          const ans = responses
            .map((r) => ({
              r,
              a: (r.content as { answers?: Record<string, { text?: string; photo?: string }> })
                ?.answers?.[String(i)],
            }))
            .filter((x) => x.a);
          return (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-800 mb-2">
                {i + 1}. {item}{" "}
                <span className="text-xs font-normal text-slate-400">({ans.length})</span>
              </div>
              <div className="space-y-2.5">
                {ans.map(({ r, a }) => (
                  <div key={r.id} className="border-l-2 border-lime-200 pl-3">
                    <div className="text-xs font-semibold text-lime-700">
                      {memberNameOf(r.user_id, r.profile?.display_name)}
                    </div>
                    {a?.text && (
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{a.text}</p>
                    )}
                    {a?.photo && (
                      <img
                        src={a.photo}
                        alt=""
                        className="mt-1 max-h-48 rounded-lg object-cover"
                      />
                    )}
                  </div>
                ))}
                {ans.length === 0 && (
                  <span className="text-xs text-slate-400">Nobody got this one.</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderAccountabilityResults = () => {
    if (!showResults || engagement.type !== "accountability") return null;
    const qs = (engagement.config?.questions as string[]) ?? [];
    const notes = responses
      .map((r) => ({ r, note: (r.content as { note?: string })?.note }))
      .filter((x) => x.note && x.note.trim());
    return (
      <div className="space-y-3">
        {qs.map((q, i) => {
          const rows = responses
            .map((r) => ({
              r,
              val: (r.content as { answers?: Record<string, number> })?.answers?.[String(i)],
            }))
            .filter((x) => typeof x.val === "number");
          const avg = rows.length
            ? rows.reduce((a, b) => a + (b.val as number), 0) / rows.length
            : 0;
          return (
            <div key={i} className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-semibold text-slate-700">🙏 {q}</div>
                {rows.length > 0 && (
                  <span className="text-xs font-bold text-violet-700">
                    {avg.toFixed(1)} avg
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {rows.map(({ r, val }) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                  >
                    {engagement.is_blind
                      ? "Anonymous"
                      : memberNameOf(r.user_id, r.profile?.display_name)}
                    <span className="font-bold text-violet-700">{val}/5</span>
                  </span>
                ))}
                {rows.length === 0 && (
                  <span className="text-xs text-slate-400">No answers.</span>
                )}
              </div>
            </div>
          );
        })}

        {/* Notes shared with the group (encouragements, verses, requests) */}
        {notes.length > 0 && (
          <div className="rounded-xl border border-violet-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-700 mb-2">
              💬 Shared with the group
            </div>
            <div className="space-y-2.5">
              {notes.map(({ r, note }) => (
                <div key={r.id} className="border-l-2 border-violet-200 pl-3">
                  <div className="text-xs font-semibold text-violet-700">
                    {engagement.is_blind
                      ? "Anonymous"
                      : memberNameOf(r.user_id, r.profile?.display_name)}
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{note}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMostLikelyResults = () => {
    if (!showResults || engagement.type !== "most_likely") return null;
    const qs = (engagement.config?.questions as string[]) ?? [];

    return (
      <div className="space-y-3">
        {qs.map((q, i) => {
          // Tally by normalized name so "Alex" and "alex " merge; keep a nice label.
          const counts: Record<string, { label: string; n: number }> = {};
          responses.forEach((r) => {
            const raw = (r.content as { answers?: Record<string, string> })?.answers?.[
              String(i)
            ];
            const name = (raw ?? "").trim();
            if (!name) return;
            const key = name.toLowerCase();
            if (!counts[key]) counts[key] = { label: name, n: 0 };
            counts[key].n++;
          });
          const entries = Object.values(counts).sort((a, b) => b.n - a.n);
          const top = entries.length ? entries[0].n : 0;
          const winners = entries.filter((e) => e.n === top && top > 0);
          const runnersUp = entries.filter((e) => e.n < top);
          return (
            <div key={i} className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="text-sm font-semibold text-slate-700 mb-1">🏆 {q}</div>
              {winners.length ? (
                <div className="text-lg font-extrabold text-amber-700">
                  {winners.map((w) => w.label).join(" & ")}{" "}
                  <span className="text-xs font-normal text-slate-500">
                    ({top} {top === 1 ? "vote" : "votes"})
                  </span>
                </div>
              ) : (
                <div className="text-sm text-slate-400">No votes for this one.</div>
              )}
              {runnersUp.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {runnersUp.slice(0, 5).map((e) => (
                    <span
                      key={e.label}
                      className="text-[11px] rounded-full bg-white border border-slate-200 text-slate-600 px-2 py-0.5"
                    >
                      {e.label} · {e.n}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderBabyRevealResults = () => {
    if (!showResults || engagement.type !== "baby_reveal") return null;
    const answer = revealAnswer?.answer ?? null;
    const tally: Record<string, number> = {};
    pollOptions.forEach((o) => (tally[o] = 0));
    responses.forEach((r) => {
      const opt = (r.content as { option?: string })?.option;
      if (opt) tally[opt] = (tally[opt] ?? 0) + 1;
    });
    const total = responses.length || 1;
    const winners = answer
      ? responses.filter((r) => (r.content as { option?: string })?.option === answer)
      : [];

    return (
      <div className="space-y-3">
        {answer ? (
          <div className="rounded-2xl border-2 border-sky-300 bg-gradient-to-br from-sky-50 to-indigo-50 p-5 text-center">
            <div className="text-4xl mb-1">🎉</div>
            <div className="text-xl font-extrabold text-slate-900">It&apos;s {answer}!</div>
            <p className="mt-1 text-sm text-slate-600">
              {winners.length === 0
                ? "Nobody guessed it!"
                : `${winners.length} guessed right: ${winners
                    .map((w) => memberNameOf(w.user_id, w.profile?.display_name))
                    .join(", ")}`}
            </p>
          </div>
        ) : (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            Guesses are in — waiting for the host to set the real answer.
          </div>
        )}

        {pollOptions.map((opt) => {
          const count = tally[opt] ?? 0;
          const pct = Math.round((count / total) * 100);
          const isAnswer = answer === opt;
          return (
            <div
              key={opt}
              className={`rounded-xl border p-3 ${
                isAnswer ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-slate-800">
                  {opt} {isAnswer && <span className="text-sky-600">✓ the answer</span>}
                </span>
                <span className="text-slate-500">
                  {count} {count === 1 ? "guess" : "guesses"} · {pct}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    isAnswer
                      ? "bg-gradient-to-r from-sky-400 to-indigo-500"
                      : "bg-slate-300"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {/* Who guessed this (names visible post-reveal) */}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {responses
                  .filter((r) => (r.content as { option?: string })?.option === opt)
                  .map((r) => (
                    <span
                      key={r.id}
                      className={`text-[11px] rounded-full px-2 py-0.5 ${
                        isAnswer
                          ? "bg-sky-100 text-sky-800 font-medium"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {memberNameOf(r.user_id, r.profile?.display_name)}
                      {r.user_id === user?.id ? " (you)" : ""}
                    </span>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderTwoTruthsResults = () => {
    if (!showResults || engagement.type !== "two_truths") return null;
    const liesRevealed = !!engagement.lies_revealed_at;
    const R = responses.length;

    const answerFor = (rid: string) =>
      lieAnswers.find((a) => a.response_id === rid)?.lie_index;
    const myGuessFor = (rid: string) =>
      lieGuesses.find((g) => g.response_id === rid && g.guesser_id === user?.id)?.guess_index;

    // How many players have finished guessing everyone else.
    const completed = responses.filter(
      (r) => lieGuesses.filter((g) => g.guesser_id === r.user_id).length >= R - 1
    ).length;

    // My score (after reveal).
    let myCorrect = 0;
    let myTotal = 0;
    if (liesRevealed) {
      responses.forEach((r) => {
        if (r.user_id === user?.id) return;
        const ans = answerFor(r.id);
        const mg = myGuessFor(r.id);
        if (ans !== undefined && mg !== undefined) {
          myTotal++;
          if (mg === ans) myCorrect++;
        }
      });
    }

    return (
      <div className="space-y-3">
        {!liesRevealed ? (
          <div className="rounded-xl bg-purple-50 border border-purple-200 p-3 text-sm text-purple-800">
            🕵️ Guessing phase — tap the statement you think is the lie on each entry.{" "}
            <span className="font-semibold">
              {completed} of {R}
            </span>{" "}
            {completed === 1 ? "player has" : "players have"} finished. The lies reveal
            once everyone&apos;s guessed.
          </div>
        ) : (
          <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm text-green-800">
            🎉 Lies revealed! You spotted{" "}
            <span className="font-bold">
              {myCorrect} of {myTotal}
            </span>{" "}
            {myTotal === 1 ? "lie" : "lies"}.
          </div>
        )}

        {responses.map((r) => {
          const statements = ((r.content as { statements?: string[] })?.statements) ?? [];
          const isMine = r.user_id === user?.id;
          const ans = answerFor(r.id);
          const mg = myGuessFor(r.id);
          const name =
            engagement.is_blind && !liesRevealed
              ? "Anonymous"
              : memberNameOf(r.user_id, r.profile?.display_name);
          const guessesForR = lieGuesses.filter((g) => g.response_id === r.id);
          const correctCount =
            ans !== undefined ? guessesForR.filter((g) => g.guess_index === ans).length : 0;

          return (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-200 to-rose-200 flex items-center justify-center text-xs font-bold text-slate-700">
                  {name[0]?.toUpperCase() ?? "?"}
                </div>
                <span className="text-sm font-medium text-slate-900">
                  {name}
                  {isMine ? " (you)" : ""}
                </span>
                {liesRevealed && !isMine && mg !== undefined && (
                  <span
                    className={`ml-auto text-xs font-semibold ${
                      mg === ans ? "text-green-600" : "text-rose-600"
                    }`}
                  >
                    {mg === ans ? "✓ You nailed it" : "✗ Fooled you"}
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                {statements.map((s, i) => {
                  const isLie = liesRevealed && ans === i;
                  const iGuessed = mg === i;
                  const canGuess = !liesRevealed && !isMine && hasResponded;
                  let cls =
                    "w-full text-left rounded-lg border px-3 py-2 text-sm transition ";
                  if (isLie) cls += "border-rose-400 bg-rose-50 text-rose-900 font-semibold";
                  else if (iGuessed) cls += "border-purple-400 bg-purple-50";
                  else
                    cls +=
                      "border-slate-200 bg-white" +
                      (canGuess ? " hover:border-purple-300 cursor-pointer" : "");
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={!canGuess}
                      onClick={() => canGuess && submitLieGuess(r.id, i)}
                      className={cls}
                    >
                      {s}
                      {isLie && <span className="ml-2 text-xs">🤥 the lie</span>}
                      {isMine && !liesRevealed && ans === i && (
                        <span className="ml-2 text-xs text-rose-500">(your lie)</span>
                      )}
                      {iGuessed && !liesRevealed && (
                        <span className="ml-2 text-xs text-purple-600">← your guess</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {!liesRevealed && !isMine && hasResponded && mg === undefined && (
                <p className="mt-1.5 text-xs text-slate-400">Tap the one you think is the lie.</p>
              )}
              {liesRevealed && (
                <p className="mt-2 text-xs text-slate-500">
                  {correctCount} of {guessesForR.length} guessed right
                  {guessesForR.length > 0 && correctCount === 0
                    ? " — you fooled everyone! 😏"
                    : ""}
                </p>
              )}
            </div>
          );
        })}

        {!liesRevealed && !hasResponded && (
          <p className="text-xs text-slate-400">Only players who submitted can guess.</p>
        )}
        {!liesRevealed && isCreator && (
          <button
            onClick={revealLiesNow}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            🎬 Reveal the lies now (don&apos;t wait for stragglers)
          </button>
        )}
      </div>
    );
  };

  const renderRevealedResponses = () => {
    if (
      !showResults ||
      engagement.type === "poll" ||
      engagement.type === "two_truths" ||
      engagement.type === "baby_reveal" ||
      engagement.type === "most_likely" ||
      engagement.type === "accountability" ||
      engagement.type === "scavenger_hunt"
    )
      return null;

    // "Guess who" candidates = everyone who responded.
    const responderNames = Array.from(
      new Set(responses.map((x) => memberNameOf(x.user_id, x.profile?.display_name)).filter(Boolean))
    ) as string[];

    return (
      <div className="space-y-3">
        {responses.map((r) => {
          const responseReactions = reactions.filter((rc) => rc.response_id === r.id);
          const content = r.content as Record<string, unknown>;

          return (
            <div
              key={r.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              {/* Author */}
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-200 to-rose-200 flex items-center justify-center text-xs font-bold text-slate-700">
                  {engagement.is_blind ? "?" : memberNameOf(r.user_id, r.profile?.display_name)[0]?.toUpperCase() ?? "?"}
                </div>
                <span className="text-sm font-medium text-slate-900">
                  {engagement.is_blind ? "Anonymous" : memberNameOf(r.user_id, r.profile?.display_name)}
                </span>
                {r.id === winnerResponseId && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                    🏆 Winner
                  </span>
                )}
              </div>

              {/* Guess who (blind engagements only, not your own response) */}
              {isRevealed && engagement.is_blind && r.user_id !== user?.id && responderNames.length > 1 && (
                <div className="mb-2 text-xs">
                  {guesses[r.id] ? (
                    guesses[r.id] === memberNameOf(r.user_id, r.profile?.display_name) ? (
                      <span className="font-medium text-green-600">
                        ✓ Nailed it — it was {memberNameOf(r.user_id, r.profile?.display_name)}!
                      </span>
                    ) : (
                      <span className="text-slate-600">
                        It was <b>{memberNameOf(r.user_id, r.profile?.display_name)}</b> — you
                        guessed {guesses[r.id]}.
                      </span>
                    )
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-slate-500">🕵️ Guess who:</span>
                      {responderNames.map((n) => (
                        <button
                          key={n}
                          onClick={() => setGuesses((g) => ({ ...g, [r.id]: n }))}
                          className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-700 hover:bg-slate-50"
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Content */}
              {content.text && (
                <p className="text-sm text-slate-700">{content.text as string}</p>
              )}
              {content.option && (
                <p className="text-sm text-slate-700 font-medium">Voted: {content.option as string}</p>
              )}
              {content.media_url && (
                <div className="mt-2 rounded-lg overflow-hidden">
                  {(content.media_type as string) === "video" ? (
                    <video
                      src={content.media_url as string}
                      controls
                      className="w-full max-h-64 object-cover"
                    />
                  ) : (
                    <img
                      src={content.media_url as string}
                      alt="Response"
                      className="w-full max-h-64 object-cover"
                    />
                  )}
                  {content.caption && (
                    <p className="text-sm text-slate-600 mt-1">{content.caption as string}</p>
                  )}
                </div>
              )}

              {/* Reactions & rating only after a true reveal */}
              {isRevealed && (
              <>
              <div className="flex items-center gap-1 mt-3 flex-wrap">
                {["👍", "😂", "❤️", "🔥", "👏", "😮"].map((emoji) => {
                  const count = responseReactions.filter((rc) => rc.emoji === emoji).length;
                  const myReaction = responseReactions.find(
                    (rc) => rc.emoji === emoji && rc.user_id === user?.id
                  );
                  return (
                    <button
                      key={emoji}
                      onClick={() => addReaction(r.id, emoji)}
                      className={`rounded-full px-2 py-0.5 text-xs border transition ${
                        myReaction
                          ? "border-orange-300 bg-orange-50"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      {emoji} {count > 0 && count}
                    </button>
                  );
                })}
              </div>

              {/* Rating */}
              <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2">
                {r.user_id === user?.id ? (
                  <span className="text-xs text-slate-400">Your entry — others rate it</span>
                ) : (
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => addRating(r.id, n)}
                        title={`Rate ${n} star${n === 1 ? "" : "s"}`}
                        className="text-base leading-none hover:scale-110 transition"
                      >
                        {n <= myRatingFor(r.id) ? "⭐" : "☆"}
                      </button>
                    ))}
                  </div>
                )}
                {(() => {
                  const { avg, count } = ratingFor(r.id);
                  return count > 0 ? (
                    <span className="text-xs font-medium text-slate-600">
                      {avg.toFixed(1)} ★ ({count})
                    </span>
                  ) : (
                    <span className="text-xs text-slate-300">no ratings yet</span>
                  );
                })()}
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px]">
                {r.user_id !== user?.id &&
                  (reportedIds.has(r.id) ? (
                    <span className="text-slate-400">Reported ✓</span>
                  ) : (
                    <button
                      onClick={() => {
                        reportResponse(r.id);
                        setReportedIds((prev) => new Set(prev).add(r.id));
                      }}
                      className="text-slate-400 hover:text-amber-600"
                    >
                      Report
                    </button>
                  ))}
                {isCreator && (
                  <button
                    onClick={() => {
                      if (confirm("Remove this response from the group?")) removeResponse(r.id);
                    }}
                    className="text-slate-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                )}
              </div>
              </>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <Link
        href={`/campfirelive/group/${groupId}`}
        className="text-sm text-slate-500 hover:text-slate-700 mb-4 inline-block"
      >
        ← Back to group
      </Link>

      {/* ── DRAFT: not live yet — only the creator can see it until launch ── */}
      {(isDraft || justLaunched) && isCreator && (
        <div
          className={`mb-6 rounded-2xl border-2 p-5 ${
            justLaunched
              ? "border-green-300 bg-green-50"
              : "border-dashed border-orange-300 bg-orange-50"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {justLaunched ? (
                <>
                  <div className="flex items-center gap-2 text-sm font-bold text-green-900">
                    <span className="rounded-full bg-green-200 px-2 py-0.5 text-[11px] uppercase tracking-wide">
                      Live
                    </span>
                    It&apos;s launched — the group can see it now
                  </div>
                  <p className="mt-1 text-xs text-green-800/80">
                    We emailed everyone in the group and any pending invitees to respond.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm font-bold text-orange-900">
                    <span className="rounded-full bg-orange-200 px-2 py-0.5 text-[11px] uppercase tracking-wide">
                      Draft
                    </span>
                    Only you can see this right now
                  </div>
                  <p className="mt-1 text-xs text-orange-800/80">
                    Review the prompt below. When you hit launch, it goes live for the
                    group and everyone (members + pending invitees) gets an email to
                    respond.
                  </p>
                </>
              )}
            </div>
            <button
              onClick={launch}
              disabled={launching || justLaunched}
              className={`rounded-full px-6 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-100 ${
                justLaunched
                  ? "bg-green-600"
                  : "bg-gradient-to-r from-orange-500 to-rose-500 hover:opacity-90 disabled:opacity-50"
              }`}
            >
              {justLaunched ? "✓ Launched" : launching ? "Launching…" : "🚀 Launch to the group"}
            </button>
          </div>
        </div>
      )}

      {/* ── Reveal Animation ── */}
      {showRevealAnimation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="text-center animate-bounce">
            <div className="text-8xl mb-4">🔓</div>
            <h2 className="text-3xl font-extrabold text-white mb-2">Results Revealed!</h2>
            <p className="text-white/80">Everyone is in — see what happened!</p>
          </div>
        </div>
      )}

      {/* ── Engagement Header ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm mb-6">
        {editing ? (
          <div className="flex items-start gap-3 mb-3">
            <span className="text-2xl sm:text-3xl flex-shrink-0">{meta?.icon ?? "📌"}</span>
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Prompt / question
                </label>
                <textarea
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Prompt / question"
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-lg font-semibold leading-snug text-slate-900 focus:border-orange-500 outline-none resize-y"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Details <span className="text-slate-400">(optional)</span>
                </label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Add more detail (optional)"
                  rows={5}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base leading-relaxed text-slate-700 focus:border-orange-500 outline-none resize-y"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Repeat
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([
                    { value: "none", label: "Once" },
                    { value: "daily", label: "🔁 Daily" },
                    { value: "weekly", label: "🔁 Weekly" },
                    { value: "monthly", label: "🔁 Monthly" },
                  ] as const).map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setEditRecurrence(r.value)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                        editRecurrence === r.value
                          ? "border-orange-500 bg-orange-50 text-slate-900"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {editRecurrence !== "none" && (
                  <p className="mt-1 text-xs text-slate-500">
                    A fresh copy auto-posts every{" "}
                    {editRecurrence === "daily"
                      ? "day"
                      : editRecurrence === "weekly"
                      ? "week"
                      : "month"}{" "}
                    after this one wraps.
                  </p>
                )}
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editAllowMemberInvites}
                  onChange={(e) => setEditAllowMemberInvites(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                />
                <div>
                  <div className="text-sm font-medium text-slate-700">
                    👥 Let members invite others to this
                  </div>
                  <div className="text-xs text-slate-500">
                    Anyone in the group can invite people to this engagement (not just you).
                  </div>
                </div>
              </label>
              {responseCount > 0 && (
                <p className="text-xs text-amber-700">
                  ⚠️ {responseCount}{" "}
                  {responseCount === 1 ? "person has" : "people have"} already
                  responded — editing changes the prompt they answered.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={saveEdit}
                  disabled={!editTitle.trim() || savingEdit}
                  className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {savingEdit ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-3">
            {/* Eyebrow + status badge on one row so the title gets full width */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="min-w-0 truncate text-xs font-semibold text-orange-600">
                {isCreator
                  ? "Your"
                  : `${memberNameOf(engagement.creator_id, engagement.creator?.display_name)}'s`}{" "}
                {meta?.label ?? engagement.type}
              </p>
              <div className="flex-shrink-0">
                {isSealed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-800">
                    🔒 Sealed
                  </span>
                )}
                {isRevealed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-3 py-1.5 text-xs font-semibold text-green-700">
                    ✓ Revealed
                  </span>
                )}
              </div>
            </div>
            {/* Icon + title (no badge competing → wraps normally) */}
            <div className="flex items-start gap-3">
              <span className="text-2xl sm:text-3xl flex-shrink-0">{meta?.icon ?? "📌"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <h1 className="min-w-0 flex-1 text-xl font-extrabold leading-tight text-slate-900 break-words">
                    {engagement.title}
                  </h1>
                  {canEdit && (
                    <button
                      onClick={startEdit}
                      title="Edit prompt"
                      className="mt-0.5 flex-shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    >
                      ✏️ Edit
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Created {new Date(engagement.created_at).toLocaleDateString()}
                  {engagement.is_blind && " · 🙈 Blind mode"}
                </p>
              </div>
            </div>
          </div>
        )}

        {!editing && (engagement.description?.trim() || meta?.hook) && (
          <p className="text-sm text-slate-600 mb-4">
            {engagement.description?.trim() || meta?.hook}
          </p>
        )}

        {/* Progress */}
        <div className="mb-2">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>
              {responseCount} of {displayExpected}{" "}
              {displayExpected === 1 ? "person" : "people"} responded
              {waitAll ? " (all invited)" : ""}
            </span>
            <span>
              {displayExpected > 0
                ? Math.round((responseCount / displayExpected) * 100)
                : 0}
              %
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isRevealed
                  ? "bg-gradient-to-r from-green-400 to-emerald-500"
                  : "bg-gradient-to-r from-orange-400 to-rose-400"
              }`}
              style={{
                width: `${
                  displayExpected > 0
                    ? Math.round((responseCount / displayExpected) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
          {/* Host-only context: invited-but-not-joined don't count toward the
              reveal (only members who've joined can respond). */}
          {inviteStats.pending > 0 && (
            <p className="mt-1.5 text-xs text-slate-500">
              {engagement.total_expected}{" "}
              {engagement.total_expected === 1 ? "person has" : "people have"} joined
              and can respond ·{" "}
              <span className="text-amber-700">
                {inviteStats.pending} invited{" "}
                {inviteStats.pending === 1 ? "person hasn't" : "people haven't"} joined
                yet
              </span>
              . The reveal waits only on those who&apos;ve joined — nudge the rest to
              pull them in before it unlocks.
            </p>
          )}
        </div>

        {/* Deadline */}
        {engagement.deadline && engagement.status === "active" && (
          <p className="text-xs text-slate-400 mt-2">
            {engagement.hold_until_deadline ? "⏳ Reveals" : "Deadline"}:{" "}
            {new Date(engagement.deadline).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {engagement.hold_until_deadline &&
              " — held until then, even if everyone responds early."}
          </p>
        )}
      </div>

      {/* ── Share a link that drops people straight into THIS engagement ──
          (To email people, use the group's invite form — one place for emails.) */}
      {!isDraft && groupInfo && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs text-slate-500">
            <span className="font-semibold text-slate-700">Invite to this engagement.</span>{" "}
            Drops them straight in — and they&apos;ll have the whole group&apos;s
            engagements at their fingertips once they join.
          </p>
          <button
            onClick={shareEngagement}
            title="Invite to this engagement — they'll see all the group's engagements once they join"
            className="flex-shrink-0 rounded-full border border-orange-300 bg-orange-50 px-4 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-100"
          >
            {sharedEng ? "✓ Copied — paste it anywhere!" : "📨 Copy invite"}
          </button>
        </div>
      )}

      {/* ── BABY REVEAL: host sets the secret answer (hidden until reveal) ── */}
      {isCreator && engagement.type === "baby_reveal" && (
        <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
          <div className="text-sm font-bold text-slate-900">
            🤫 The real answer
            {revealAnswer ? " — set, kept secret until the reveal" : " (only you can set this)"}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 mb-2">
            Pick the true answer. It stays hidden from everyone until
            {deadlineStr ? ` ${deadlineStr}` : " the reveal"} — then winners light up.
          </p>
          <div className="flex flex-wrap gap-2">
            {pollOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setRevealAnswer(opt)}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
                  revealAnswer?.answer === opt
                    ? "border-sky-500 bg-sky-500 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-sky-400"
                }`}
              >
                {opt}
                {revealAnswer?.answer === opt ? " ✓" : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── CREATOR CONTROL: force the reveal / end the engagement anytime ── */}
      {isCreator && engagement.status === "active" && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-900">
                You started this — you control the reveal
              </div>
              <p className="text-xs text-slate-500">
                {responseCount} of {engagement.total_expected} responded.
                {engagement.reveal === "all_at_once"
                  ? " Reveal whenever you're ready."
                  : " Nudged everyone and some won't respond? End it early and reveal."}
              </p>
            </div>
            <button
              onClick={revealNow}
              className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-5 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              🎬 Reveal now
            </button>
          </div>

          {engagement.reveal === "sealed" && (
            <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
              When does it open?
            </div>
          )}

          {/* Option 1: reveal ON the date, regardless of who's responded */}
          {engagement.reveal === "sealed" && engagement.deadline && (
            <label className="mt-2 flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!!engagement.hold_until_deadline}
                onChange={(e) => {
                  setHoldUntilDeadline(e.target.checked);
                  // Revealing on the date overrides "wait for everyone".
                  if (e.target.checked && waitAll) setWaitForAllInvited(false);
                }}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
              />
              <div>
                <div className="text-sm font-medium text-slate-700">
                  ⏳ Reveal on the date — no matter who&apos;s responded (surprise mode)
                </div>
                <div className="text-xs text-slate-500">
                  Opens{" "}
                  {new Date(engagement.deadline).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  regardless — like a gift on the day. Off = reveals as soon as everyone
                  who&apos;s in has responded.
                </div>
              </div>
            </label>
          )}

          {/* Option 2: only matters when NOT revealing on the date */}
          {engagement.reveal === "sealed" && (
            <label
              className={`mt-2 flex items-start gap-3 ${
                engagement.hold_until_deadline ? "opacity-50" : "cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={waitAll && !engagement.hold_until_deadline}
                disabled={!!engagement.hold_until_deadline}
                onChange={(e) => setWaitForAllInvited(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
              />
              <div>
                <div className="text-sm font-medium text-slate-700">
                  ✉️ Wait until everyone invited has joined &amp; responded
                </div>
                <div className="text-xs text-slate-500">
                  {engagement.hold_until_deadline
                    ? "Not used — it opens on the date regardless (uncheck the date option to use this)."
                    : "Don't reveal just because the joined members answered — hold until invited people join and respond too."}
                  {!engagement.hold_until_deadline && pendingCount > 0
                    ? ` ${pendingCount} invited ${
                        pendingCount === 1 ? "person hasn't" : "people haven't"
                      } joined yet.`
                    : ""}
                  {!engagement.hold_until_deadline && engagement.deadline
                    ? " (The deadline still acts as a backstop.)"
                    : ""}
                </div>
              </div>
            </label>
          )}
        </div>
      )}

      {/* ── CREATOR CONTROL: un-reveal (e.g. it revealed earlier than wanted) ── */}
      {isCreator && isRevealed && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-900">
                Revealed too early? Put it back.
              </div>
              <p className="text-xs text-slate-500">
                Re-seals it for everyone. Existing responses are kept — turn on
                &ldquo;wait until the deadline&rdquo; next so it holds for the surprise.
              </p>
            </div>
            <button
              onClick={async () => {
                const { error: unErr } = await unrevealEngagement();
                if (unErr) {
                  alert("Couldn't un-reveal: " + unErr);
                  return;
                }
                // If there's a future deadline, offer to hold it until then.
                if (
                  engagement.deadline &&
                  new Date(engagement.deadline).getTime() > Date.now() &&
                  typeof window !== "undefined" &&
                  window.confirm("Hold it sealed until the deadline so it can't re-reveal early?")
                ) {
                  await setHoldUntilDeadline(true);
                }
              }}
              className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ↩️ Un-reveal (re-seal)
            </button>
          </div>
        </div>
      )}

      {/* ── SEALED STATE: Waiting for everyone ── */}
      {isSealed && hasResponded && !allIn && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-6 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">🔒</span>
            <div>
              <h2 className="font-bold text-amber-900">Results are sealed</h2>
              <p className="text-sm text-amber-700">
                {responseCount} of {displayExpected} have responded. {revealRule}
              </p>
            </div>
          </div>

          {/* Waiting animation */}
          <div className="flex items-center gap-2 mb-4">
            <div className="flex gap-1">
              {Array.from({ length: Math.max(displayExpected, 1) }).map((_, i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full transition-all ${
                    i < responseCount
                      ? "bg-orange-500"
                      : "bg-slate-200 animate-pulse"
                  }`}
                  style={{
                    animationDelay: i < responseCount ? "0s" : `${(i - responseCount) * 0.3}s`,
                  }}
                />
              ))}
            </div>
            <span className="text-xs text-amber-700">
              {engagement.hold_until_deadline && deadlineStr
                ? `Sealed until ${deadlineStr}`
                : `Waiting for ${Math.max(displayExpected - responseCount, 0)} more...`}
            </span>
          </div>

          {/* Your response confirmation */}
          <div className="rounded-xl bg-white/60 border border-amber-200 p-3 mb-3">
            <div className="flex items-center gap-2 text-sm text-amber-900">
              <span>✓</span>
              <span className="font-medium">Your response is locked in</span>
            </div>
            {myResponse?.content && (
              <p className="text-xs text-amber-700 mt-1">
                {(myResponse.content as Record<string, unknown>).option
                  ? `You voted: ${(myResponse.content as Record<string, unknown>).option}`
                  : (myResponse.content as Record<string, unknown>).text
                  ? "Text response submitted"
                  : "Response submitted"}
              </p>
            )}
          </div>

          {/* Nudge button — emails everyone who hasn't responded */}
          <div className="flex items-center gap-3">
            <button
              onClick={nudgeStragglers}
              disabled={nudgeMsg === "Sending…"}
              className="rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
            >
              👋 Nudge Stragglers
            </button>
            {nudgeMsg && nudgeMsg !== "Sending…" && (
              <span className="text-xs font-medium text-amber-700">{nudgeMsg}</span>
            )}
          </div>
        </div>
      )}

      {/* ── ALL-AT-ONCE: non-creators wait for the creator (creator has the control above) ── */}
      {awaitingCreatorReveal && hasResponded && !isCreator && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-6 mb-6">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎬</span>
            <div>
              <h2 className="font-bold text-amber-900">Waiting for the reveal</h2>
              <p className="text-sm text-amber-700">
                {responseCount} of {engagement.total_expected} responded. The creator
                will reveal the results.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── RESPONSE FORM (not yet responded) ── */}
      {engagement.status === "active" && !hasResponded && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm mb-6">
          <h2 className="font-bold text-slate-900 mb-4">Your Response</h2>
          {engagement.reveal === "sealed" && (
            <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 mb-4">
              <span>🔒</span>
              <p className="text-xs text-amber-800">
                Results are sealed. Nobody will see your response until everyone has responded.
              </p>
            </div>
          )}
          {engagement.is_blind && (
            <div className="flex items-center gap-2 rounded-xl bg-violet-50 border border-violet-200 px-3 py-2 mb-4">
              <span>🙈</span>
              <p className="text-xs text-violet-800">
                This is anonymous — your answer won&apos;t show who you are. Answer freely
                and honestly.
              </p>
            </div>
          )}
          {renderResponseForm()}
        </div>
      )}

      {/* ── RESULTS (revealed, or live as-they-come / instant) ── */}
      {showResults && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-900">
              {justRevealed
                ? "🎉 Results Are In!"
                : isRevealed
                ? "Results"
                : "Live results"}
            </h2>
            {isRevealed && (
              <button
                onClick={shareResults}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                📤 Share
              </button>
            )}
          </div>
          {!isRevealed && liveMode && (
            <p className="-mt-2 mb-4 text-xs text-slate-500">
              {engagement.reveal === "instant"
                ? "Instant mode — responses appear the moment they're in."
                : "As-they-come — responses show up live."}
            </p>
          )}

          {/* Poll results */}
          {renderPollResults()}

          {/* Two Truths & a Lie — guess-the-lie + scored reveal */}
          {renderTwoTruthsResults()}

          {/* Baby Reveal — tally + winners */}
          {renderBabyRevealResults()}

          {/* Most Likely To… — winner per award */}
          {renderMostLikelyResults()}

          {/* Accountability — per-question ratings */}
          {renderAccountabilityResults()}

          {/* Scavenger Hunt — per-item answers */}
          {renderScavengerResults()}

          {/* Other response types */}
          {renderRevealedResponses()}

          {/* Comments section (post-reveal only) */}
          {isRevealed && (
          <div className="mt-6">
            <h3 className="font-bold text-slate-900 mb-3">
              Comments ({comments.length})
            </h3>

            {comments.map((c) => (
              <div key={c.id} className="flex gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-200 to-rose-200 flex items-center justify-center text-xs font-bold text-slate-700 flex-shrink-0">
                  {c.profile?.display_name?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div>
                  <span className="text-xs font-medium text-slate-700">
                    {memberNameOf(c.user_id, c.profile?.display_name)}
                  </span>
                  <p className="text-sm text-slate-600">{c.content}</p>
                </div>
              </div>
            ))}

            <div className="flex gap-2 mt-3">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCommentSubmit()}
                placeholder="Add a comment..."
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-orange-500 outline-none"
              />
              <button
                onClick={handleCommentSubmit}
                disabled={!commentText.trim()}
                className="rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
          )}
        </div>
      )}

      {/* Already responded but engagement is instant/as-they-come reveal */}
      {hasResponded && engagement.status === "active" && engagement.reveal !== "sealed" && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 mb-6">
          <div className="flex items-center gap-2 text-sm text-green-800">
            <span>✓</span>
            <span className="font-medium">Response submitted!</span>
          </div>
        </div>
      )}

      {/* ── Your turn: nudge the participant to start their own ── */}
      {(hasResponded || isRevealed) && (
        <Link
          href={`/campfirelive/group/${groupId}/engagement/new`}
          className={`block rounded-2xl border-2 border-dashed p-5 text-center transition mb-6 ${
            iWon
              ? "border-amber-400 bg-amber-50 hover:bg-amber-100"
              : "border-orange-300 bg-orange-50/60 hover:bg-orange-50"
          }`}
        >
          <div className="text-2xl mb-1">{iWon ? "🏆" : "🔥"}</div>
          <div className="font-bold text-slate-900">
            {iWon
              ? "You won! Start the next engagement"
              : isRevealed
              ? "Your turn — start the next one"
              : "While you wait, start your own"}
          </div>
          <p className="text-sm text-slate-600 mt-0.5">
            {iWon
              ? "Winner's privilege — pose the next one for the group. 🎉"
              : "Pose a question, challenge, or check-in and keep the group going."}
          </p>
          <span className="inline-block mt-3 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-5 py-2 text-sm font-semibold text-white">
            + Start an engagement
          </span>
        </Link>
      )}

      {/* Creator: cancel (delete) the engagement */}
      {isCreator && (
        <div className="mt-2 text-center">
          <button
            onClick={cancelEngagement}
            className="text-xs text-slate-400 underline hover:text-red-600"
          >
            Cancel this engagement
          </button>
        </div>
      )}
    </div>
  );
}
