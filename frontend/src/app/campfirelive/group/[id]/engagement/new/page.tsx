"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useCreateEngagement } from "@/lib/campfire/hooks";
import { ENGAGEMENT_TYPES, type EngagementType, type RevealMode } from "@/lib/campfire/types";
import { TEMPLATE_PACKS, type EngagementTemplate } from "@/lib/campfire/templates";

export default function NewEngagementPage() {
  const params = useParams();
  const groupId = params.id as string;
  const router = useRouter();
  const { create } = useCreateEngagement(groupId);

  const [step, setStep] = useState<"type" | "details" | "options">("type");
  const [selectedType, setSelectedType] = useState<EngagementType | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reveal, setReveal] = useState<RevealMode>("sealed");
  const [isBlind, setIsBlind] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly">("none");
  const [notify, setNotify] = useState(true);
  const [pollOptions, setPollOptions] = useState(["", "", ""]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const handleSelectType = (type: EngagementType) => {
    setSelectedType(type);
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
    if (selectedType === "poll") {
      const opts = pollOptions.filter((o) => o.trim());
      if (opts.length < 2) {
        setError("Add at least 2 options for your poll.");
        setCreating(false);
        return;
      }
      config.options = opts;
    }

    if (selectedType === "challenge") {
      config.media_type = "photo"; // Default, could be made selectable
    }

    const result = await create({
      type: selectedType,
      title: title.trim(),
      description: description.trim() || undefined,
      config,
      deadline: deadline ? new Date(deadline) : undefined,
      reveal,
      is_blind: isBlind,
      recurrence_rule: recurrence === "none" ? undefined : recurrence,
      notify,
    });

    if (result.error) {
      setError(result.error);
      setCreating(false);
    } else if (result.engagement) {
      // Created as a DRAFT — the creator reviews it and hits Launch when ready.
      router.push(`/campfirelive/group/${groupId}/engagement/${result.engagement.id}`);
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

            {/* Poll-specific: options */}
            {selectedType === "poll" && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Poll Options
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
            {/* Reveal Mode */}
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

            {/* Blind mode */}
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

            {/* Deadline */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Deadline <span className="text-slate-400">(optional)</span>
              </label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
              />
            </div>

            {/* Repeat */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Repeat <span className="text-slate-400">(optional)</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "none" as const, label: "Once" },
                  { value: "daily" as const, label: "🔁 Daily" },
                  { value: "weekly" as const, label: "🔁 Weekly" },
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
                  {recurrence === "daily" ? "day" : "week"} after this one wraps.
                </p>
              )}
            </div>

            {/* Email notifications */}
            <div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                />
                <div>
                  <div className="text-sm font-medium text-slate-700">
                    📧 Email the group when I launch
                  </div>
                  <div className="text-xs text-slate-500">
                    On launch, email members + invitees to respond (and again when
                    results reveal). You launch when you&apos;re ready — nothing sends now.
                  </div>
                </div>
              </label>
            </div>

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
