"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Me } from "./_lib/api";

export default function BehaviorDashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<Me>("/me")
      .then(setMe)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-slate-500">Loading…</p>;

  if (!getToken()) {
    return (
      <Card>
        <h1 className="text-xl font-semibold">Sign in to Behaviours</h1>
        <p className="mt-2 text-slate-600">
          Behaviours uses your Curriculate account. Please sign in to continue.
        </p>
        <Link
          href={loginHref("/behavior")}
          className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-white"
        >
          Sign in
        </Link>
      </Card>
    );
  }

  if (error) return <Card><p className="text-red-600">{error}</p></Card>;

  // Signed in but no school yet → originator setup CTA.
  if (!me?.membership) {
    return (
      <Card>
        <h1 className="text-xl font-semibold">Set up your school</h1>
        <p className="mt-2 text-slate-600">
          You don&apos;t belong to a Behaviours school yet. If you&apos;re setting one up for your
          division, create it here. Otherwise, ask your admin to invite you.
        </p>
        <Link
          href="/behavior/setup"
          className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-white"
        >
          Create a school
        </Link>
      </Card>
    );
  }

  const { membership, school } = me;
  const isAdmin = membership.role === "originator" || membership.role === "admin";
  const canLog = membership.role !== "principal";

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-slate-500">{school?.name}</p>
        <h1 className="text-xl font-semibold">
          Hi{membership.name ? `, ${membership.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm text-slate-500 capitalize">Role: {membership.role}</p>
      </Card>

      {canLog && (
        <Link
          href="/behavior/log"
          className="block rounded-xl bg-slate-900 px-5 py-4 text-center text-lg font-semibold text-white shadow-sm"
        >
          + Log an incident
        </Link>
      )}

      <Card>
        <h2 className="font-semibold">Reminder for today</h2>
        <p className="mt-1 text-sm text-slate-500">
          Outstanding consequence follow-ups will appear here (Phase 2).
        </p>
      </Card>

      {isAdmin && (
        <Card>
          <h2 className="font-semibold">Admin</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <Link href="/behavior/setup" className="rounded-lg border border-slate-300 px-3 py-1.5">
              Division setup
            </Link>
            <Link href="/behavior/setup#roster" className="rounded-lg border border-slate-300 px-3 py-1.5">
              Import roster
            </Link>
            <Link href="/behavior/setup#invite" className="rounded-lg border border-slate-300 px-3 py-1.5">
              Invite teachers
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">{children}</section>;
}
