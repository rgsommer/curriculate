"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { useEngagement, useRealtimeEngagement } from "@/lib/campfire/hooks";
import { ENGAGEMENT_TYPES } from "@/lib/campfire/types";
import { supabase } from "@/lib/campfire/supabase";

export default function EngagementDetailPage() {
  const params = useParams();
  const groupId = params.id as string;
  const engagementId = params.engId as string;
  const { user } = useAuth();

  const {
    engagement,
    responses,
    reactions,
    comments,
    myResponse,
    responseCount,
    loading,
    submitResponse,
    addReaction,
    addComment,
    sendNudge,
    refresh,
  } = useEngagement(engagementId);

  // Real-time: auto-refresh when anything changes
  const handleRealtimeUpdate = useCallback(() => {
    refresh();
  }, [refresh]);
  useRealtimeEngagement(engagementId, handleRealtimeUpdate);

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
  const hasResponded = !!myResponse;
  const allIn = responseCount >= engagement.total_expected;
  const isCreator = engagement.creator_id === user?.id;
  const pollOptions = (engagement.config?.options as string[]) ?? [];
  const canEdit = isCreator && engagement.status === "active";

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

  // ── Submit handlers ──

  const handlePollSubmit = async () => {
    if (!selectedOption) return;
    setSubmitting(true);
    await submitResponse({ option: selectedOption });
    setSubmitting(false);
  };

  const handleTextSubmit = async () => {
    if (!textInput.trim()) return;
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
    if (!isRevealed || engagement.type !== "poll") return null;

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
    if (!isRevealed || engagement.type === "poll") return null;

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
              </div>

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

              {/* Reactions */}
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
              <div className="space-y-2">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Prompt / question"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-semibold text-slate-900 focus:border-orange-500 outline-none"
                  autoFocus
                />
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Add more detail (optional)"
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-orange-500 outline-none resize-none"
                />
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
                <div className="flex items-start gap-2">
                  <h1 className="text-xl font-extrabold text-slate-900">{engagement.title}</h1>
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
                <p className="text-xs text-slate-500 mt-0.5">
                  {meta?.label ?? engagement.type} · Created{" "}
                  {new Date(engagement.created_at).toLocaleDateString()}
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

        {!editing && engagement.description && (
          <p className="text-sm text-slate-600 mb-4">{engagement.description}</p>
        )}

        {/* Progress */}
        <div className="mb-2">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>
              {responseCount} of {engagement.total_expected} responded
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

          {/* Nudge button */}
          <button
            onClick={() => {
              // Nudge all who haven't responded
              // In a real app, we'd know exactly who hasn't responded
              // For now, this is a general nudge action
              alert("Nudges sent to group members who haven't responded yet!");
            }}
            className="rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50"
          >
            👋 Nudge Stragglers
          </button>
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

      {/* ── REVEALED: Results ── */}
      {isRevealed && (
        <div className="mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4">
            {justRevealed ? "🎉 Results Are In!" : "Results"}
          </h2>

          {/* Poll results */}
          {renderPollResults()}

          {/* Other response types */}
          {renderRevealedResponses()}

          {/* Comments section */}
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
    </div>
  );
}
