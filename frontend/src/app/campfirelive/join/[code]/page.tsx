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
  const { user, session, loading: authLoading } = useAuth();
  const { joinGroup } = useGroups();
  const [status, setStatus] = useState<"loading" | "joining" | "success" | "error">("loading");
  const [error, setError] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);

  // The invited address (?inv=…) and an optional target engagement (?e=…) so we
  // can drop the joiner straight into the engagement they were invited to.
  const params2 =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const invEmail = params2?.get("inv") ?? null;
  const engId = params2?.get("e") ?? null;

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // Send them to sign in, then back here (preserving ?inv and ?e) to finish.
      const qs = new URLSearchParams();
      if (invEmail) qs.set("inv", invEmail);
      if (engId) qs.set("e", engId);
      const joinPath = `/campfirelive/join/${code}${qs.toString() ? `?${qs}` : ""}`;
      router.push(`/campfirelive/auth?next=${encodeURIComponent(joinPath)}`);
      return;
    }

    // Auto-join
    setStatus("joining");
    joinGroup(code).then((result) => {
      if (result.error && !result.groupId) {
        setStatus("error");
        setError(result.error);
      } else {
        setStatus("success");
        setGroupId(result.groupId ?? null);
        // Mark the email-invitation joined (handles sign-in with a different email).
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
          if (result.groupId && engId) {
            // Jump straight into the engagement they were invited to.
            router.push(`/campfirelive/group/${result.groupId}/engagement/${engId}`);
          } else {
            router.push(result.groupId ? `/campfirelive/group/${result.groupId}` : "/campfirelive");
          }
        }, 1500);
      }
    });
  }, [user, session, authLoading, code, invEmail, engId, joinGroup, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        {status === "loading" || status === "joining" ? (
          <>
            <div className="text-5xl mb-4 animate-pulse">🔥</div>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Joining group...</h1>
            <p className="text-slate-500">Invite code: {code}</p>
          </>
        ) : status === "success" ? (
          <>
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-2">You&apos;re in!</h1>
            <p className="text-slate-500">Redirecting to your new group...</p>
          </>
        ) : (
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
        )}
      </div>
    </div>
  );
}
