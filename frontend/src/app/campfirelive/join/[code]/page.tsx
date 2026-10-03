"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { useGroups } from "@/lib/campfire/hooks";
import { CF_PRIMARY } from "@/lib/campfire/ui";

export default function JoinGroupPage() {
  const params = useParams();
  const code = params.code as string;
  const router = useRouter();
  const { user, session, loading: authLoading, signInAsGuest } = useAuth();
  const { joinGroup, joinEngagementAsGuest } = useGroups();
  const [status, setStatus] = useState<"loading" | "joining" | "success" | "error">("loading");
  const [error, setError] = useState("");

  // Guest-join form
  const [guestName, setGuestName] = useState("");
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestErr, setGuestErr] = useState("");
  // Optional result-email (only offered for result-returning engagements — ?r=1).
  // Held in a ref too so the post-join effect can read it without re-running.
  const [guestEmail, setGuestEmail] = useState("");
  const guestEmailRef = useRef("");

  // The invited address (?inv=…) and an optional target engagement (?e=…) so we
  // can drop the joiner straight into the engagement they were invited to.
  const params2 =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const invEmail = params2?.get("inv") ?? null;
  const engId = params2?.get("e") ?? null;
  // r=1 → this engagement reveals results to participants (a contest), so offer an
  // optional "email me my results". Cards/RSVPs omit it (one-way, no results).
  const wantsResults = params2?.get("r") === "1";
  // ?gone=1 → a short card link (/c/…) that no longer resolves.
  const linkGone = params2?.get("gone") === "1";

  // Check the code BEFORE anything else, so a bad/expired link never creates a guest
  // account, and a good one can say who's inviting you to what.
  type InviteInfo = {
    group: { name: string; emoji: string; host: string | null };
    card: { title: string } | null;
  };
  const [invite, setInvite] = useState<"checking" | "invalid" | InviteInfo>(
    linkGone ? "invalid" : "checking"
  );
  useEffect(() => {
    if (linkGone) return;
    let cancelled = false;
    const qs = new URLSearchParams({ code });
    if (engId) qs.set("e", engId);
    fetch(`/api/campfire/invite/info?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setInvite(d?.ok ? { group: d.group, card: d.card ?? null } : "invalid");
      })
      .catch(() => {
        // Network hiccup: don't block a possibly-valid invite — fall back to the
        // old behaviour (the join RPC itself still rejects a bad code).
        if (!cancelled) setInvite({ group: { name: "", emoji: "🔥", host: null }, card: null });
      });
    return () => {
      cancelled = true;
    };
  }, [code, engId, linkGone]);
  const info = typeof invite === "object" ? invite : null;

  // Once we have a signed-in user (guest or email), do the actual join.
  useEffect(() => {
    if (authLoading || !user || invite === "checking") return;
    if (invite === "invalid") {
      setStatus("error");
      setError(
        "This invite link has expired or isn't valid anymore. Ask whoever sent it for a new one."
      );
      return;
    }

    setStatus("joining");

    // A link scoped to a single engagement (?e=…) joins as a GUEST of just that
    // card — no group membership. A plain group link joins as a full member.
    if (engId) {
      // Guest of just this card. The invited email (if any) is passed to the RPC,
      // which marks that engagement-scoped invitation joined — without touching
      // group membership or the group's invitation list.
      joinEngagementAsGuest(engId, invEmail).then((result) => {
        if (result.error && !result.groupId) {
          setStatus("error");
          setError(result.error);
        } else {
          setStatus("success");
          // Save their optional result-email on the guest row (for contests).
          if (guestEmailRef.current && session && result.groupId) {
            fetch("/api/campfire/guest/notify-email", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({
                engId,
                groupId: result.groupId,
                email: guestEmailRef.current,
              }),
            }).catch(() => {});
          }
          // Also mark any WHOLE-GROUP invitation for this email as joined — so if
          // they were invited to the group at this address but reached it via a
          // card link (and/or already joined under another email), it flips too.
          if (invEmail && session && result.groupId) {
            fetch("/api/campfire/invite/accept", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ groupId: result.groupId, email: invEmail }),
            }).catch(() => {});
          }
          setTimeout(() => {
            router.push(`/campfirelive/group/${result.groupId}/engagement/${engId}`);
          }, 1500);
        }
      });
      return;
    }

    joinGroup(code).then((result) => {
      if (result.error && !result.groupId) {
        setStatus("error");
        setError(result.error);
      } else {
        setStatus("success");
        if (invEmail && session && result.groupId) {
          fetch("/api/campfire/invite/accept", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ groupId: result.groupId, email: invEmail }),
          }).catch(() => {});
        }
        setTimeout(() => {
          router.push(result.groupId ? `/campfirelive/group/${result.groupId}` : "/campfirelive");
        }, 1500);
      }
    });
  }, [user, session, authLoading, code, invEmail, engId, joinGroup, joinEngagementAsGuest, router, invite]);

  const handleGuest = async () => {
    const name = guestName.trim();
    if (!name) {
      setGuestErr("Please enter your name.");
      return;
    }
    setGuestErr("");
    setGuestBusy(true);
    const { error: gErr, rateLimited } = await signInAsGuest(name);
    if (gErr) {
      setGuestErr(
        rateLimited
          ? "Lots of people are joining at once — wait about a minute, then tap again. (Or use email below.)"
          : /disabled|not enabled/i.test(gErr)
          ? "Guest join isn't switched on yet — use email below, or ask whoever invited you."
          : gErr
      );
      setGuestBusy(false);
    }
    // On success: the auth state change sets `user`, and the effect above joins.
  };

  const goEmail = () => {
    const qs = new URLSearchParams();
    if (invEmail) qs.set("inv", invEmail);
    if (engId) qs.set("e", engId);
    const joinPath = `/campfirelive/join/${code}${qs.toString() ? `?${qs}` : ""}`;
    router.push(`/campfirelive/auth?next=${encodeURIComponent(joinPath)}`);
  };

  const joining = guestBusy || (!!user && (status === "loading" || status === "joining"));

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        {authLoading || (invite === "checking" && !user) ? (
          <>
            <div className="text-5xl mb-4 animate-pulse">🔥</div>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-2">One sec…</h1>
          </>
        ) : joining && invite !== "invalid" ? (
          <>
            <div className="text-5xl mb-4 animate-pulse">🔥</div>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Joining…</h1>
            {info?.group.name && (
              <p className="text-slate-500">
                {info.group.emoji} {info.card?.title ?? info.group.name}
              </p>
            )}
          </>
        ) : status === "success" ? (
          <>
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-2">You&apos;re in!</h1>
            <p className="text-slate-500">Taking you there…</p>
          </>
        ) : status === "error" || invite === "invalid" ? (
          <>
            <div className="text-5xl mb-4">{invite === "invalid" ? "🔗" : "😕"}</div>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-2">
              {invite === "invalid" ? "This link has expired" : "Couldn't join"}
            </h1>
            <p className="text-slate-600 mb-5">
              {invite === "invalid"
                ? "This invite link isn't valid anymore. Ask whoever sent it to share a fresh one."
                : "Something went wrong joining. Check your connection and try the link again."}
            </p>
            <Link
              href={user ? "/campfirelive" : "/campfirelive/auth"}
              className={`${CF_PRIMARY}`}
            >
              {user ? "Go to my groups" : "Open Campfire"}
            </Link>
          </>
        ) : (
          // Not signed in → offer the two ways to join. An engagement-scoped invite
          // (?e=…) is framed as "sign this one card", NOT "join the group".
          <div className="text-left">
            <div className="text-center mb-5">
              <div className="text-5xl mb-2">{engId ? "🎉" : "🔥"}</div>
              <h1 className="text-2xl font-extrabold text-slate-900">You&apos;re invited!</h1>
              {info?.group.name && (
                <p className="mt-2 text-lg font-bold text-slate-800">
                  {info.card ? info.card.title : `${info.group.emoji} ${info.group.name}`}
                </p>
              )}
              {info?.group.host && (
                <p className="text-sm text-slate-500">
                  {info.card ? `in ${info.group.emoji} ${info.group.name} · ` : ""}
                  hosted by {info.group.host}
                </p>
              )}
              <p className="text-slate-500 text-sm mt-2">
                {engId
                  ? "Add your message — just your name, no account, and you're only signing this one card."
                  : info?.group.name
                  ? "Join the group to take part."
                  : "Join the Campfire group."}
              </p>
            </div>

            {/* Guest join — fastest, no account */}
            <div className="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-bold text-slate-900 mb-1">
                {engId ? "Sign with your name" : "Join as guest"}
              </div>
              <p className="text-xs text-slate-500 mb-2">
                {engId
                  ? "Just your name — no email, no password, no app to install."
                  : "Just your name — no email, no password. Best on the one device you'll keep using."}
              </p>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGuest()}
                placeholder="Your name (e.g. Alex S.)"
                maxLength={40}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none"
              />
              {wantsResults && (
                <>
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => {
                      setGuestEmail(e.target.value);
                      guestEmailRef.current = e.target.value.trim();
                    }}
                    placeholder="Email (optional) — to get your results"
                    maxLength={120}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Add your email and we&apos;ll send you the results when they&apos;re in.
                    Skip it to stay anonymous.
                  </p>
                </>
              )}
              {guestErr && <p className="mt-1.5 text-xs text-red-600">{guestErr}</p>}
              <button
                onClick={handleGuest}
                disabled={guestBusy || !guestName.trim()}
                className={`${CF_PRIMARY} mt-2 w-full`}
              >
                {guestBusy ? "One sec…" : engId ? "✍️ Sign the card" : "🔥 Join as guest"}
              </button>
            </div>

            {/* Email / Google join — keeps your spot across devices */}
            <div className="mt-3 text-center">
              <button
                onClick={goEmail}
                className="text-sm font-medium text-slate-600 underline hover:text-slate-800"
              >
                {engId ? "Or sign in with email / Google" : "Or join with email / Google"}
              </button>
              <p className="mt-1 text-xs text-slate-500">
                Keeps your spot on any device.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
