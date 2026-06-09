"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/campfire/AuthProvider";
import { useGroups } from "@/lib/campfire/hooks";

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

  // The invited address (?inv=…) and an optional target engagement (?e=…) so we
  // can drop the joiner straight into the engagement they were invited to.
  const params2 =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const invEmail = params2?.get("inv") ?? null;
  const engId = params2?.get("e") ?? null;

  // Once we have a signed-in user (guest or email), do the actual join.
  useEffect(() => {
    if (authLoading || !user) return;

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
  }, [user, session, authLoading, code, invEmail, engId, joinGroup, joinEngagementAsGuest, router]);

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
        {authLoading ? (
          <>
            <div className="text-5xl mb-4 animate-pulse">🔥</div>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-2">One sec…</h1>
          </>
        ) : joining ? (
          <>
            <div className="text-5xl mb-4 animate-pulse">🔥</div>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Joining…</h1>
            <p className="text-slate-500">Invite code: {code}</p>
          </>
        ) : status === "success" ? (
          <>
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-2">You&apos;re in!</h1>
            <p className="text-slate-500">Taking you there…</p>
          </>
        ) : status === "error" ? (
          <>
            <div className="text-5xl mb-4">😕</div>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Couldn&apos;t join</h1>
            <p className="text-slate-500 mb-4">{error}</p>
            <Link
              href="/campfirelive"
              className="inline-block rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-2.5 text-sm font-semibold text-white"
            >
              Go to Dashboard
            </Link>
          </>
        ) : (
          // Not signed in → offer the two ways to join. An engagement-scoped invite
          // (?e=…) is framed as "sign this one card", NOT "join the group".
          <div className="text-left">
            <div className="text-center mb-5">
              <div className="text-5xl mb-2">{engId ? "🎉" : "🔥"}</div>
              <h1 className="text-2xl font-extrabold text-slate-900">You&apos;re invited!</h1>
              <p className="text-slate-500 text-sm mt-1">
                {engId
                  ? "Add your message to a Campfire card — just your name, no account, and you're only signing this one card."
                  : (
                    <>
                      Join the Campfire group (code{" "}
                      <span className="font-mono">{code}</span>)
                    </>
                  )}
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
              {guestErr && <p className="mt-1.5 text-xs text-red-600">{guestErr}</p>}
              <button
                onClick={handleGuest}
                disabled={guestBusy || !guestName.trim()}
                className="mt-2 w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
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
              <p className="mt-1 text-xs text-slate-400">
                {engId ? "Use this to keep access across devices." : "Pick this for more results."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
