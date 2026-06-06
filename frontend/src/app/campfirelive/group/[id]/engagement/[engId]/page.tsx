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
    loading,
    submitResponse,
    addReaction,
    addRating,
    addComment,
    sendNudge,
    revealNow,
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
      if (!cancelled && data) {
        setInviteStats({
          joined: data.filter((r) => r.status === "joined").length,
          pending: data.filter((r) => r.status === "pending").length,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // Local UI state
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
  const [savingEdit, setSavingEdit] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [justLaunched, setJustLaunched] = useState(false);
  // Invite context for the host: how many were invited but haven't joined yet.
  // (RLS lets only the group admin read invitations, so non-admins just get 0.)
  const [inviteStats, setInviteStats] = useState({ joined: 0, pending: 0 });
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
    }
    prevStatusRef.current = engagement?.status ?? null;
  }, [engagement?.status]);

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
  const allIn = responseCount >= engagement.total_expected;
  const isCreator = engagement.creator_id === user?.id;
  const isDraft = !engagement.launched_at;
  const pollOptions = (engagement.config?.options as string[]) ?? [];
  const canEdit = isCreator && engagement.status === "active";

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
              placeholder="Add a caption (optional)"
              rows={2}
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

  const renderRevealedResponses = () => {
    if (!showResults || engagement.type === "poll") return null;

    // "Guess who" candidates = everyone who responded.
    const responderNames = Array.from(
      new Set(responses.map((x) => x.profile?.display_name).filter(Boolean))
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
                  {engagement.is_blind ? "?" : r.profile?.display_name?.[0]?.toUpperCase() ?? "?"}
                </div>
                <span className="text-sm font-medium text-slate-900">
                  {engagement.is_blind ? "Anonymous" : r.profile?.display_name ?? "Unknown"}
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
                    guesses[r.id] === (r.profile?.display_name ?? "") ? (
                      <span className="font-medium text-green-600">
                        ✓ Nailed it — it was {r.profile?.display_name}!
                      </span>
                    ) : (
                      <span className="text-slate-600">
                        It was <b>{r.profile?.display_name}</b> — you guessed {guesses[r.id]}.
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
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm mb-6">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-3xl">{meta?.icon ?? "📌"}</span>
          <div className="flex-1">
            {editing ? (
              <div className="space-y-3">
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
            ) : (
              <>
                <p className="text-xs font-semibold text-orange-600">
                  {isCreator
                    ? "Your"
                    : `${engagement.creator?.display_name ?? "Someone"}'s`}{" "}
                  {meta?.label ?? engagement.type}
                </p>
                <div className="flex items-start gap-2">
                  <h1 className="text-xl font-extrabold text-slate-900">{engagement.title}</h1>
                  {canEdit && (
                    <button
                      onClick={startEdit}
                      title="Edit prompt"
                      className="mt-1 flex-shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    >
                      ✏️ Edit
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Created {new Date(engagement.created_at).toLocaleDateString()}
                  {engagement.is_blind && " · 🙈 Blind mode"}
                </p>
              </>
            )}
          </div>

          {/* Status badge */}
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

        {!editing && (engagement.description?.trim() || meta?.hook) && (
          <p className="text-sm text-slate-600 mb-4">
            {engagement.description?.trim() || meta?.hook}
          </p>
        )}

        {/* Progress */}
        <div className="mb-2">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>
              {responseCount} of {engagement.total_expected}{" "}
              {engagement.total_expected === 1 ? "member" : "members"} responded
            </span>
            <span>
              {engagement.total_expected > 0
                ? Math.round((responseCount / engagement.total_expected) * 100)
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
                  engagement.total_expected > 0
                    ? Math.round((responseCount / engagement.total_expected) * 100)
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
            Deadline:{" "}
            {new Date(engagement.deadline).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        )}
      </div>

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
                {responseCount} of {engagement.total_expected} have responded. Results
                will be revealed when everyone is in.
              </p>
            </div>
          </div>

          {/* Waiting animation */}
          <div className="flex items-center gap-2 mb-4">
            <div className="flex gap-1">
              {Array.from({ length: engagement.total_expected }).map((_, i) => (
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
              Waiting for {engagement.total_expected - responseCount} more...
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
                    {c.profile?.display_name ?? "Unknown"}
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
