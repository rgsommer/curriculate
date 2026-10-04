"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/campfire/supabase";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { useGroups } from "@/lib/campfire/hooks";
import { freeGroupAllowance } from "@/lib/campfire/premium";
import { CF_PRIMARY_SM, CF_SECONDARY, CF_SECONDARY_SM } from "@/lib/campfire/ui";

type HostedGroup = { id: string; name: string; emoji: string; mine: boolean };

// "Move to another group" — for an activity made in the wrong group. Offered only before
// anyone has responded (the server enforces it too: responders belong to the old group).
// Lists the groups you host, or makes a new one and moves it there in one step.
export default function MoveActivity({
  engagementId,
  currentGroupId,
  onMoved,
  disabledReason,
}: {
  engagementId: string;
  currentGroupId: string;
  onMoved: (targetGroupId: string) => void;
  // Set once someone has responded: the button stays visible but greyed, with the reason
  // shown inline (phones have no hover tooltips).
  disabledReason?: string | null;
}) {
  const { user, session, isTrialActive } = useAuth();
  const { createGroup } = useGroups();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<HostedGroup[] | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    supabase
      .from("group_members")
      .select("group_id, groups(id, name, avatar_emoji, creator_id)")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .then(({ data }) => {
        if (cancelled) return;
        type Row = {
          groups:
            | { id: string; name: string; avatar_emoji: string | null; creator_id: string }
            | { id: string; name: string; avatar_emoji: string | null; creator_id: string }[]
            | null;
        };
        const list = ((data ?? []) as Row[])
          .map((r) => (Array.isArray(r.groups) ? r.groups[0] : r.groups))
          .filter((g): g is NonNullable<typeof g> => !!g)
          .map((g) => ({
            id: g.id,
            name: g.name,
            emoji: g.avatar_emoji || "🔥",
            mine: g.creator_id === user.id,
          }));
        setGroups(list);
      });
    return () => {
      cancelled = true;
    };
  }, [open, user?.id]);

  // New groups follow the same free-plan rule as the dashboard (earned groups aren't
  // counted here — a host who has earned more can still create from the dashboard).
  const hostedCount = (groups ?? []).filter((g) => g.mine).length;
  const canMakeGroup = isTrialActive || hostedCount < freeGroupAllowance(0).allowed;
  const targets = (groups ?? []).filter((g) => g.id !== currentGroupId);

  const moveTo = async (targetGroupId: string) => {
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/campfire/engagement/move", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ engagementId, targetGroupId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j?.error || "Couldn't move it. Try again.");
        return;
      }
      setOpen(false);
      onMoved(targetGroupId);
    } finally {
      setBusy(false);
    }
  };

  const createAndMove = async () => {
    const name = newName.trim();
    if (!name) return;
    setErr("");
    setBusy(true);
    const { group, error } = await createGroup(name, "", "🔥");
    if (!group) {
      setBusy(false);
      setErr(error ?? "Couldn't create the group.");
      return;
    }
    await moveTo(group.id);
  };

  if (disabledReason) {
    return (
      <span
        aria-disabled="true"
        title={disabledReason}
        className="inline-flex cursor-not-allowed items-center gap-1 text-xs font-medium text-slate-400"
      >
        ↪️ <span className="line-through decoration-slate-300">Move to another group</span>
        <span className="no-underline">({disabledReason})</span>
      </span>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Made it in the wrong group? Move it — before anyone responds."
        className="text-xs font-medium text-slate-500 underline hover:text-orange-600"
      >
        ↪️ Move to another group
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => !busy && setOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && !busy && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-title"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="move-title" className="text-base font-bold text-slate-900">
              Move to another group
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Nobody has responded yet, so it moves cleanly — its link, invites and
              schedule come along.
            </p>

            <div className="mt-4 space-y-2">
              {groups === null ? (
                <p className="animate-pulse text-sm text-slate-500">Loading your groups…</p>
              ) : targets.length === 0 ? (
                <p className="text-sm text-slate-500">You don&apos;t host any other groups yet.</p>
              ) : (
                targets.map((g) => (
                  <button
                    key={g.id}
                    disabled={busy}
                    onClick={() => moveTo(g.id)}
                    className={`${CF_SECONDARY} w-full !justify-start`}
                  >
                    <span aria-hidden>{g.emoji}</span> {g.name}
                  </button>
                ))
              )}
            </div>

            {groups !== null && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                {canMakeGroup ? (
                  <>
                    <label htmlFor="move-new-group" className="text-sm font-medium text-slate-700">
                      + Or make a new group for it
                    </label>
                    <div className="mt-2 flex gap-2">
                      <input
                        id="move-new-group"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && createAndMove()}
                        placeholder="e.g. 7C Class 2026"
                        maxLength={60}
                        className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-orange-500 sm:text-sm"
                      />
                      <button
                        disabled={busy || !newName.trim()}
                        onClick={createAndMove}
                        className={CF_PRIMARY_SM}
                      >
                        Create &amp; move
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    Your free plan&apos;s groups are all in use, so a new one can&apos;t be made
                    here — pick one of your groups above.
                  </p>
                )}
              </div>
            )}

            {err && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {err}
              </p>
            )}

            <div className="mt-4 text-right">
              <button disabled={busy} onClick={() => setOpen(false)} className={CF_SECONDARY_SM}>
                {busy ? "Moving…" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
