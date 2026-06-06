"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useCreateEngagement, useGroups } from "@/lib/campfire/hooks";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { supabase } from "@/lib/campfire/supabase";
import { ENGAGEMENT_TYPES, type EngagementType, type RevealMode } from "@/lib/campfire/types";
import { TEMPLATE_PACKS, type EngagementTemplate } from "@/lib/campfire/templates";

export default function NewEngagementPage() {
  const params = useParams();
  const groupId = params.id as string;
  const router = useRouter();
  const { create } = useCreateEngagement();
  const { groups, createGroup } = useGroups();
  const { user } = useAuth();

  const [step, setStep] = useState<"type" | "details" | "options">("type");
  const [selectedType, setSelectedType] = useState<EngagementType | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reveal, setReveal] = useState<RevealMode>("sealed");
  const [isBlind, setIsBlind] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [holdUntilDeadline, setHoldUntilDeadline] = useState(false);
  const [waitForAllInvited, setWaitForAllInvited] = useState(false);
  const [allowMemberInvites, setAllowMemberInvites] = useState(false);
  // Surprise / "All Except": members hidden from it until the reveal.
  const [groupMembers, setGroupMembers] = useState<{ user_id: string; name: string }[]>([]);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [pendingForTarget, setPendingForTarget] = useState(0);
  const waitTouched = useRef(false); // don't override a manual toggle
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [pollOptions, setPollOptions] = useState(["", "", ""]);
  // "Most Likely To…" awards (one engagement, many questions)
  const [questions, setQuestions] = useState<string[]>(["", "", ""]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Where to post: the current group by default, another group, or a new one.
  const [targetGroupId, setTargetGroupId] = useState<string>(groupId);
  const [makingNewGroup, setMakingNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // Smart default: if the destination group still has people pending on the
  // invite list, default "wait for all invited" ON (you can still flip it). A
  // brand-new group has no invites, so it stays off.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (makingNewGroup) {
        if (!cancelled) {
          setPendingForTarget(0);
          if (!waitTouched.current) setWaitForAllInvited(false);
        }
        return;
      }
      const { data } = await supabase.rpc("pending_invite_count", {
        _gid: targetGroupId,
      });
      if (!cancelled) {
        const p = (data as number) ?? 0;
        setPendingForTarget(p);
        if (!waitTouched.current) setWaitForAllInvited(p > 0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetGroupId, makingNewGroup]);

  // Roster of the destination group (for the surprise "hide from" picker).
  useEffect(() => {
    if (makingNewGroup) {
      setGroupMembers([]);
      setExcludedIds([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("group_members")
        .select("user_id, display_name, profile:profiles(display_name)")
        .eq("group_id", targetGroupId);
      if (!cancelled && data) {
        const list = (
          data as {
            user_id: string;
            display_name: string | null;
            profile: { display_name: string } | { display_name: string }[] | null;
          }[]
        )
          .filter((m) => m.user_id !== user?.id) // can't surprise yourself
          .map((m) => {
            const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
            return { user_id: m.user_id, name: m.display_name || p?.display_name || "Someone" };
          });
        setGroupMembers(list);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetGroupId, makingNewGroup, user?.id]);

  const handleSelectType = (type: EngagementType) => {
    setSelectedType(type);
    if (type === "two_truths") {
      if (!title.trim()) setTitle("Two truths and a lie — what are yours?");
      if (!description.trim())
        setDescription("Share three statements about yourself — two true, one a lie. We'll all guess the lie!");
      setReveal("sealed"); // statements stay sealed until everyone's in
    }
    if (type === "baby_reveal") {
      if (!title.trim()) setTitle("Boy or girl? 🍼");
      if (!description.trim())
        setDescription("Lock in your guess — all is revealed on the big day!");
      setPollOptions(["Boy", "Girl"]);
      setReveal("sealed"); // guesses stay sealed until the reveal date
    }
    if (type === "most_likely") {
      if (!title.trim()) setTitle("Most Likely To… 🏆");
      if (!description.trim())
        setDescription("Vote a group-mate for each award. Sealed until the reveal!");
      setQuestions([
        "Most likely to change the world",
        "Always makes everyone laugh",
        "The friend you can always count on",
      ]);
      setReveal("sealed");
    }
    if (type === "scavenger_hunt") {
      if (!title.trim()) setTitle("Scavenger Hunt 🔍");
      if (!description.trim())
        setDescription("Find each one — snap a photo or type your answer. Any order!");
      setQuestions([
        "Something that represents teamwork",
        "The oldest thing you can find",
        "A word that starts with Q",
      ]);
      setReveal("sealed");
    }
    if (type === "accountability") {
      if (!title.trim()) setTitle("Accountability check-in 🙏");
      if (!description.trim())
        setDescription("Answer honestly — set responses to blind if you'd like.");
      setQuestions([
        "Have you kept up with daily prayer/reading?",
        "Have you guarded your heart and eyes this week?",
        "Have you invested in your closest relationships?",
      ]);
      setReveal("sealed");
    }
    setStep("details");
  };

  const applyTemplate = (t: EngagementTemplate) => {
    setSelectedType(t.type);
    setTitle(t.title);
    setDescription(t.description ?? "");
    if (t.type === "poll") {
      const opts = t.options ?? [];
      setPollOptions(opts.length >= 2 ? opts : [...opts, "", ""].slice(0, 3));
    }
    setStep("details");
  };

  const handleSubmit = async () => {
    if (!selectedType || !title.trim()) return;
    setCreating(true);
    setError("");

    const config: Record<string, unknown> = {};

    // Type-specific config
    if (selectedType === "poll" || selectedType === "baby_reveal") {
      const opts = pollOptions.filter((o) => o.trim());
      if (opts.length < 2) {
        setError(
          selectedType === "baby_reveal"
            ? "Add at least 2 choices to guess between."
            : "Add at least 2 options for your poll."
        );
        setCreating(false);
        return;
      }
      config.options = opts;
    }

    // Baby Reveal auto-opens on a date — a reveal date is required.
    if (selectedType === "baby_reveal" && !deadline) {
      setError("Pick the reveal date — that's when it unseals.");
      setCreating(false);
      return;
    }

    if (
      selectedType === "most_likely" ||
      selectedType === "accountability" ||
      selectedType === "scavenger_hunt"
    ) {
      const qs = questions.map((q) => q.trim()).filter(Boolean);
      if (qs.length < 1) {
        setError(
          selectedType === "accountability"
            ? "Add at least one check-in question."
            : selectedType === "scavenger_hunt"
            ? "Add at least one item to find."
            : "Add at least one award (a “Most likely to…” question)."
        );
        setCreating(false);
        return;
      }
      config.questions = qs;
    }

    if (selectedType === "challenge") {
      config.media_type = "photo"; // Default, could be made selectable
    }

    // Resolve the destination group — make a new one first if requested.
    let destGroupId = targetGroupId;
    if (makingNewGroup) {
      if (!newGroupName.trim()) {
        setError("Give your new group a name.");
        setCreating(false);
        return;
      }
      const { group, error: gErr } = await createGroup(newGroupName.trim(), "", "🔥");
      if (gErr || !group) {
        setError(gErr || "Couldn't create the group.");
        setCreating(false);
        return;
      }
      destGroupId = group.id;
    }

    const result = await create({
      groupId: destGroupId,
      type: selectedType,
      title: title.trim(),
      description: description.trim() || undefined,
      config,
      deadline: deadline ? new Date(deadline) : undefined,
      reveal:
        selectedType === "two_truths" ||
        selectedType === "baby_reveal" ||
        selectedType === "most_likely" ||
        selectedType === "accountability" ||
        selectedType === "scavenger_hunt"
          ? "sealed"
          : reveal,
      is_blind: selectedType === "two_truths" ? false : isBlind,
      recurrence_rule: recurrence === "none" ? undefined : recurrence,
      notify: true, // launching always notifies the group
      // Baby Reveal always holds until the date; others only when opted in.
      hold_until_deadline:
        selectedType === "baby_reveal"
          ? true
          : reveal === "sealed" && !!deadline && holdUntilDeadline,
      // Wait for the full invite list to join + respond (sealed only).
      wait_for_all_invited:
        (selectedType === "two_truths" || reveal === "sealed") && waitForAllInvited,
      // Let members (not just the host) invite others to this engagement.
      allow_member_invites: allowMemberInvites,
      // Surprise: hide it from these members until the reveal.
      excluded_user_ids: makingNewGroup ? [] : excludedIds,
    });

    if (result.error) {
      setError(result.error);
      setCreating(false);
    } else if (result.engagement) {
      // Created as a DRAFT — the creator reviews it and hits Launch when ready.
      router.push(`/campfirelive/group/${destGroupId}/engagement/${result.engagement.id}`);
    }
  };

  return (
    <div>
      <Link
        href={`/campfirelive/group/${groupId}`}
        className="text-sm text-slate-500 hover:text-slate-700 mb-4 inline-block"
      >
        ← Back to group
      </Link>

      <h1 className="text-2xl font-extrabold text-slate-900 mb-6">New Engagement</h1>

      {/* Step 1: Choose Type */}
      {step === "type" && (
        <div>
          {/* Templates — start from a ready-made one */}
          <div className="mb-8 rounded-2xl border border-orange-200 bg-orange-50/50 p-4">
            <p className="text-sm font-semibold text-slate-700 mb-3">
              ⚡ Start from a template
            </p>
            <div className="space-y-4">
              {TEMPLATE_PACKS.map((pack) => (
                <div key={pack.id}>
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">
                    {pack.emoji} {pack.name}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pack.templates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => applyTemplate(t)}
                        title={t.title}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-orange-300 hover:bg-orange-50"
                      >
                        {ENGAGEMENT_TYPES[t.type].icon} {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-slate-500 mb-4">…or start from scratch — what kind of engagement?</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(Object.entries(ENGAGEMENT_TYPES) as [EngagementType, typeof ENGAGEMENT_TYPES[EngagementType]][]).map(
              ([type, meta]) => (
                <button
                  key={type}
                  onClick={() => handleSelectType(type)}
                  className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm hover:shadow-md hover:-translate-y-0.5 transition"
                >
                  <div className="text-3xl mb-2">{meta.icon}</div>
                  <div className="font-bold text-sm text-slate-900">{meta.label}</div>
                  <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {meta.description}
                  </div>
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Step 2: Details */}
      {step === "details" && selectedType && (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <span className="text-3xl">{ENGAGEMENT_TYPES[selectedType].icon}</span>
            <div>
              <h2 className="font-bold text-slate-900">{ENGAGEMENT_TYPES[selectedType].label}</h2>
              <button
                onClick={() => setStep("type")}
                className="text-xs text-orange-600 underline"
              >
                Change type
              </button>
            </div>
          </div>

          <div className="space-y-4 max-w-lg">
            {/* Posting target — this group, another group, or a brand-new one */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Posting to
              </label>
              <select
                value={makingNewGroup ? "__new__" : targetGroupId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setMakingNewGroup(true);
                  } else {
                    setMakingNewGroup(false);
                    setTargetGroupId(e.target.value);
                  }
                }}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none bg-white"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.avatar_emoji} {g.name}
                    {g.id === groupId ? " (this group)" : ""}
                  </option>
                ))}
                <option value="__new__">➕ New group…</option>
              </select>
              {makingNewGroup && (
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Name your new group (e.g. Book Club)"
                  autoFocus
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
                />
              )}
              <p className="mt-1 text-xs text-slate-500">
                Everyone in the chosen group is emailed to respond the moment you launch.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  selectedType === "poll"
                    ? "e.g. What should we eat on Saturday?"
                    : selectedType === "challenge"
                    ? "e.g. Best sunset photo this week"
                    : "Give your engagement a title"
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Description <span className="text-slate-400">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add more context or rules..."
                rows={3}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none resize-none"
              />
            </div>

            {/* Poll / Baby Reveal: the choices */}
            {(selectedType === "poll" || selectedType === "baby_reveal") && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {selectedType === "baby_reveal" ? "Choices to guess between" : "Poll Options"}
                </label>
                {pollOptions.map((opt, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => {
                        const next = [...pollOptions];
                        next[i] = e.target.value;
                        setPollOptions(next);
                      }}
                      placeholder={`Option ${i + 1}`}
                      className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
                    />
                    {pollOptions.length > 2 && (
                      <button
                        onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}
                        className="text-slate-400 hover:text-red-500 px-2"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {pollOptions.length < 8 && (
                  <button
                    onClick={() => setPollOptions([...pollOptions, ""])}
                    className="text-sm text-orange-600 font-medium"
                  >
                    + Add option
                  </button>
                )}
              </div>
            )}

            {/* Most Likely To… / Accountability / Scavenger Hunt — list of items */}
            {(selectedType === "most_likely" ||
              selectedType === "accountability" ||
              selectedType === "scavenger_hunt") && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {selectedType === "accountability"
                    ? "The check-in questions (each rated 1–5)"
                    : selectedType === "scavenger_hunt"
                    ? "The items to find (each answered with a photo or text)"
                    : "The awards (each one becomes a vote)"}
                </label>
                {questions.map((q, i) => (
                  <div key={i} className="flex gap-2 mb-2 items-center">
                    <span className="text-slate-400 text-sm">
                      {selectedType === "accountability"
                        ? "🙏"
                        : selectedType === "scavenger_hunt"
                        ? `${i + 1}.`
                        : "🏆"}
                    </span>
                    <input
                      type="text"
                      value={q}
                      onChange={(e) => {
                        const next = [...questions];
                        next[i] = e.target.value;
                        setQuestions(next);
                      }}
                      placeholder={
                        selectedType === "accountability"
                          ? "Have you…?"
                          : selectedType === "scavenger_hunt"
                          ? "Find / answer…"
                          : "Most likely to…"
                      }
                      className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
                    />
                    {questions.length > 1 && (
                      <button
                        onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
                        className="text-slate-400 hover:text-red-500 px-2"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {questions.length < 30 && (
                  <button
                    onClick={() => setQuestions([...questions, ""])}
                    className="text-sm text-orange-600 font-medium"
                  >
                    {selectedType === "accountability"
                      ? "+ Add question"
                      : selectedType === "scavenger_hunt"
                      ? "+ Add item"
                      : "+ Add award"}
                  </button>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {selectedType === "accountability"
                    ? "Each person rates themselves 1–5 on every question. Turn on Blind below to keep answers anonymous."
                    : selectedType === "scavenger_hunt"
                    ? "Players answer each with a photo or a typed answer, in any order. Sealed until you reveal (use 🎬 Reveal now or a deadline)."
                    : "Everyone votes a group-mate for each award; winners are crowned at the reveal."}
                </p>
              </div>
            )}

            <button
              onClick={() => setStep("options")}
              disabled={!title.trim()}
              className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              Next: Set Options
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Options (reveal, blind, deadline) */}
      {step === "options" && selectedType && (
        <div>
          <button
            onClick={() => setStep("details")}
            className="text-sm text-slate-500 hover:text-slate-700 mb-4 inline-block"
          >
            ← Back to details
          </button>

          <h2 className="text-lg font-bold text-slate-900 mb-4">Engagement Options</h2>

          <div className="space-y-5 max-w-lg">
            {/* Reveal Mode — hidden for types that are always sealed */}
            {selectedType !== "two_truths" &&
              selectedType !== "baby_reveal" &&
              selectedType !== "most_likely" &&
              selectedType !== "accountability" &&
              selectedType !== "scavenger_hunt" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Reveal Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "sealed" as const, label: "🔒 Sealed", desc: "Results hidden until everyone responds" },
                  { value: "all_at_once" as const, label: "🎬 All at Once", desc: "Creator triggers the reveal" },
                  { value: "as_they_come" as const, label: "📨 As They Come", desc: "See responses in real-time" },
                  { value: "instant" as const, label: "⚡ Instant", desc: "Results visible immediately" },
                ].map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setReveal(r.value)}
                    className={`rounded-xl border p-3 text-left transition ${
                      reveal === r.value
                        ? "border-orange-500 bg-orange-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="text-sm font-bold text-slate-900">{r.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{r.desc}</div>
                  </button>
                ))}
              </div>
              {reveal === "sealed" && (
                <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  🔒 This is the Campfire signature mechanic. Nobody sees results until the
                  last person responds — turning every engagement into a shared reveal event.
                </div>
              )}
            </div>
            )}

            {/* Blind mode — not relevant for Two Truths / Baby Reveal / Most Likely / Scavenger */}
            {selectedType !== "two_truths" &&
              selectedType !== "baby_reveal" &&
              selectedType !== "most_likely" &&
              selectedType !== "scavenger_hunt" && (
              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isBlind}
                    onChange={(e) => setIsBlind(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-700">
                      🙈 Blind Responses
                    </div>
                    <div className="text-xs text-slate-500">
                      Hide identities — no one knows whose response is whose
                    </div>
                  </div>
                </label>
              </div>
            )}

            {/* Deadline */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {selectedType === "baby_reveal" ? (
                  <>
                    🍼 Reveal date <span className="text-rose-500">(required)</span>
                  </>
                ) : (
                  <>
                    Deadline <span className="text-slate-400">(optional)</span>
                  </>
                )}
              </label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
              />
              {selectedType === "baby_reveal" && (
                <p className="mt-1 text-xs text-slate-500">
                  Guesses stay sealed until this exact moment, then it auto-reveals with
                  the winners. Set the real answer on the engagement before then.
                </p>
              )}

              {/* Hold the reveal until the deadline — only for sealed mode (baby
                  reveal already always holds, so don't show the toggle there) */}
              {reveal === "sealed" && selectedType !== "baby_reveal" && (
                <label
                  className={`mt-2 flex items-start gap-3 rounded-xl border p-3 ${
                    deadline
                      ? "border-slate-200 bg-white cursor-pointer"
                      : "border-slate-100 bg-slate-50 opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={holdUntilDeadline}
                    disabled={!deadline}
                    onChange={(e) => {
                      setHoldUntilDeadline(e.target.checked);
                      if (e.target.checked) setWaitForAllInvited(false);
                    }}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-700">
                      ⏳ Reveal on the date — no matter who&apos;s responded (surprise mode)
                    </div>
                    <div className="text-xs text-slate-500">
                      {deadline
                        ? "Opens at the deadline regardless — like a birthday gift on the day. Off = reveals as soon as everyone who's in has responded (or at the deadline, whichever comes first)."
                        : "Set a deadline above to enable this."}
                    </div>
                  </div>
                </label>
              )}

              {/* Wait for the whole invite list — only when NOT revealing on the date */}
              {(reveal === "sealed" || selectedType === "two_truths") &&
                selectedType !== "baby_reveal" && (
                <label
                  className={`mt-2 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 ${
                    holdUntilDeadline ? "opacity-50" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={waitForAllInvited && !holdUntilDeadline}
                    disabled={holdUntilDeadline}
                    onChange={(e) => {
                      waitTouched.current = true;
                      setWaitForAllInvited(e.target.checked);
                    }}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-700">
                      ✉️ Wait until everyone invited has joined &amp; responded
                    </div>
                    <div className="text-xs text-slate-500">
                      {holdUntilDeadline
                        ? "Not used — the date option above opens it regardless. Uncheck that to use this."
                        : (
                          <>
                            {waitForAllInvited && !waitTouched.current && pendingForTarget > 0 && (
                              <span className="text-amber-700">
                                On by default — {pendingForTarget} invited{" "}
                                {pendingForTarget === 1 ? "person hasn't" : "people haven't"}{" "}
                                joined yet.{" "}
                              </span>
                            )}
                            Don&apos;t reveal just because the joined members answered —
                            hold it until invited people join and respond too.{" "}
                            {deadline
                              ? "The deadline still acts as a backstop."
                              : "⚠️ Add a deadline as a backstop so it can't freeze if someone never joins."}
                          </>
                        )}
                    </div>
                  </div>
                </label>
              )}
            </div>

            {/* Repeat */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Repeat <span className="text-slate-400">(optional)</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { value: "none" as const, label: "Once" },
                  { value: "daily" as const, label: "🔁 Daily" },
                  { value: "weekly" as const, label: "🔁 Weekly" },
                  { value: "monthly" as const, label: "🔁 Monthly" },
                ].map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setRecurrence(r.value)}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                      recurrence === r.value
                        ? "border-orange-500 bg-orange-50 text-slate-900"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              {recurrence !== "none" && (
                <p className="mt-1.5 text-xs text-slate-500">
                  A fresh copy auto-posts to the group every{" "}
                  {recurrence === "daily" ? "day" : recurrence === "weekly" ? "week" : "month"}{" "}
                  after this one wraps.
                </p>
              )}
            </div>

            {/* Surprise: hide from selected members until the reveal */}
            {groupMembers.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-sm font-medium text-slate-700">
                  🎁 Surprise — hide from… <span className="text-slate-400">(optional)</span>
                </div>
                <p className="text-xs text-slate-500 mb-2">
                  Anyone you pick won&apos;t see it (or get emailed) until the reveal —
                  then everyone gets it, including them. Great for a birthday card.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {groupMembers.map((m) => {
                    const on = excludedIds.includes(m.user_id);
                    return (
                      <button
                        key={m.user_id}
                        type="button"
                        onClick={() =>
                          setExcludedIds((prev) =>
                            on ? prev.filter((id) => id !== m.user_id) : [...prev, m.user_id]
                          )
                        }
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${
                          on
                            ? "border-rose-500 bg-rose-500 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:border-rose-300"
                        }`}
                      >
                        {on ? "🙈 " : ""}
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Launch notifies the group — no toggle, so nobody gets left out. */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-600">
              📧 This stays a private draft until you hit Launch. The moment you
              launch, everyone in the group{" "}
              {excludedIds.length > 0 ? "(except your surprise picks) " : ""}
              gets an email to respond — and again when the results reveal.
            </div>

            {/* Let members invite others to this engagement */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allowMemberInvites}
                onChange={(e) => setAllowMemberInvites(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
              />
              <div>
                <div className="text-sm font-medium text-slate-700">
                  👥 Let members invite others to this
                </div>
                <div className="text-xs text-slate-500">
                  Anyone in the group (not just you) can invite people to this
                  engagement. Off = only you can.
                </div>
              </div>
            </label>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</p>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={creating}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-3 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Creating..." : "✏️ Create draft — review & launch next"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
