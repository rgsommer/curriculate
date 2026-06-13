"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/campfire/supabase";
import { useCreateEngagement } from "@/lib/campfire/hooks";

// Pre-filled from the family list — REVIEW before creating. Format per line:
//   Name, date[, recipient]
// where date is YYYY-MM-DD or "Month D, YYYY", and the optional 3rd field is the
// "All Except" recipient — the person the card is hidden from (a member NAME, or an
// email). For little ones, change it to a PARENT. Defaults to the birthday person.
const DEFAULT_LIST = `Laura, 1973-09-04, Laura
Amber, 1995-09-18, Amber
Andie Jocelyn, 2021-09-25, Andie Jocelyn
Stephanie Irene, 1997-10-03, Stephanie Irene
Michael William, 2023-10-07, Michael William
Mila Joy, 2022-11-30, Mila Joy
Zack Stares, 1994-01-23, Zack Stares
Evan Emmanuel, 1996-04-14, Evan Emmanuel
Davey Bruce Bennett, 2025-04-18, Davey Bruce Bennett
Peregrin Zackary, 2022-04-19, Peregrin Zackary
Brock Reggie, 2024-04-29, Brock Reggie
Richard, 1967-05-03, Richard
Ulissa Grace, 1999-05-08, Ulissa Grace
Maverick Job, 2025-05-23, Maverick Job
Jonathan Richard, 1994-05-29, Jonathan Richard
Sarah-Lynn Naomi, 2001-02-08, Sarah-Lynn Naomi
Krew Wesley, 2021-02-15, Krew Wesley
Archie Zion Sommer, 2026-02-16, Archie Zion Sommer
Isaiah, 1998-02-21, Isaiah
Katherine Laura Stares, 2025-03-13, Katherine Laura Stares
Taylor, 1997-03-28, Taylor
Tamara Sommer, 2005-02-16, Tamara Sommer`;

const DAY = 24 * 60 * 60 * 1000;
const LEAD_DAYS = 14;

type Parsed = { name: string; date: Date; recipient: string };

function parseLine(line: string): Parsed | null {
  const s = line.trim();
  if (!s) return null;
  const firstComma = s.indexOf(",");
  if (firstComma < 0) return null;
  const name = s.slice(0, firstComma).trim();
  const rest = s.slice(firstComma + 1).trim();
  if (!name || !rest) return null;
  // Pull the date off the start of `rest` (handles ISO and "Month D, YYYY", which
  // itself contains a comma); anything after the date is the recipient.
  const iso = rest.match(/^(\d{4}-\d{1,2}-\d{1,2})/);
  const mon = rest.match(/^([A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/);
  const dateStr = iso ? iso[1] : mon ? mon[1] : "";
  if (!dateStr) return null;
  const recipient = rest.slice(dateStr.length).replace(/^\s*,?\s*/, "").trim();
  const ds = /^\d{4}-\d{1,2}-\d{1,2}$/.test(dateStr) ? dateStr + "T12:00:00" : dateStr;
  const d = new Date(ds);
  if (isNaN(d.getTime())) return null;
  return { name, date: d, recipient };
}

export default function BulkBirthdaysPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;
  const { create } = useCreateEngagement(groupId);

  const [text, setText] = useState(DEFAULT_LIST);
  const [coverFrom, setCoverFrom] = useState(""); // engagement id to copy pics from
  const [templates, setTemplates] = useState<
    { id: string; title: string; urls: string[] }[]
  >([]);
  const [roster, setRoster] = useState<{ user_id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  // Existing birthday cards that have cover pictures — to reuse the art.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("engagements")
        .select("id, title, cover_image_urls, cover_image_url, type")
        .eq("group_id", groupId)
        .eq("type", "birthday");
      const t = (data ?? [])
        .map((e) => {
          const urls = ((e.cover_image_urls as string[] | null) ?? []).slice();
          if (urls.length === 0 && e.cover_image_url)
            urls.push(e.cover_image_url as string);
          return { id: e.id as string, title: (e.title as string) ?? "Card", urls };
        })
        .filter((e) => e.urls.length > 0);
      setTemplates(t);
      if (t[0]) setCoverFrom(t[0].id);

      const { data: mem } = await supabase
        .from("group_members")
        .select("user_id, display_name, profile:profiles(display_name)")
        .eq("group_id", groupId);
      setRoster(
        (mem ?? []).map((m) => {
          const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
          return {
            user_id: m.user_id as string,
            name:
              (m.display_name as string | null) ||
              (p as { display_name?: string } | null)?.display_name ||
              "",
          };
        })
      );
    })();
  }, [groupId]);

  // Resolve a recipient string to a member id (by name) or an email.
  const resolveRecipient = (r: string): { uid?: string; email?: string } => {
    const v = r.trim();
    if (!v) return {};
    if (v.includes("@")) return { email: v.toLowerCase() };
    const lc = v.toLowerCase();
    const m =
      roster.find((x) => x.name.toLowerCase() === lc) ||
      roster.find(
        (x) =>
          x.name && (x.name.toLowerCase().includes(lc) || lc.includes(x.name.toLowerCase()))
      );
    return m ? { uid: m.user_id } : {};
  };

  const parsed = useMemo(
    () => text.split("\n").map(parseLine).filter(Boolean) as Parsed[],
    [text]
  );
  const badLines = useMemo(
    () => text.split("\n").filter((l) => l.trim() && !parseLine(l)),
    [text]
  );

  const run = async () => {
    if (busy || parsed.length === 0) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Create ${parsed.length} recurring birthday cards? They'll be drafts that auto-open ~${LEAD_DAYS} days before each birthday.`
      )
    )
      return;
    setBusy(true);
    setLog([]);
    setDone(false);
    const urls = templates.find((t) => t.id === coverFrom)?.urls ?? [];
    const now = Date.now();
    let ok = 0;
    for (const p of parsed) {
      const month = p.date.getMonth();
      const day = p.date.getDate();
      const birthYear = p.date.getFullYear();
      let next = new Date(new Date().getFullYear(), month, day, 9, 0, 0);
      if (next.getTime() <= now) next = new Date(next.getFullYear() + 1, month, day, 9, 0, 0);
      const scheduledOpen = new Date(next.getTime() - LEAD_DAYS * DAY);
      const rec = resolveRecipient(p.recipient);
      const recNote = !p.recipient
        ? " · no recipient (set later)"
        : rec.uid
        ? ` · hidden from ${p.recipient}`
        : rec.email
        ? ` · hidden from ${rec.email}`
        : ` · ⚠️ recipient "${p.recipient}" not matched — set it on the card`;
      try {
        const r = await create({
          groupId,
          type: "birthday",
          title: `Happy {age} Birthday, ${p.name}! 🎂`,
          description:
            "Sign the card with your birthday wishes — it opens on the big day!",
          reveal: "sealed",
          recurrence_rule: "yearly",
          hold_until_deadline: true,
          deadline: next,
          scheduled_open_at: scheduledOpen.toISOString(),
          lead_days: LEAD_DAYS,
          birth_year: birthYear,
          launched_at: null,
          notify: true,
          excluded_user_ids: rec.uid ? [rec.uid] : undefined,
          excluded_emails: rec.email ? [rec.email] : undefined,
          cover_image_urls: urls.length ? urls : undefined,
          cover_image_url: urls[0],
        });
        if ((r as { error?: unknown })?.error) {
          setLog((l) => [...l, `❌ ${p.name}: ${(r as { error?: string }).error}`]);
        } else {
          ok++;
          setLog((l) => [
            ...l,
            `✅ ${p.name} — opens ${scheduledOpen.toLocaleDateString()}${recNote}`,
          ]);
        }
      } catch (e) {
        setLog((l) => [...l, `❌ ${p.name}: ${(e as Error).message}`]);
      }
    }
    setLog((l) => [...l, `— Done. ${ok}/${parsed.length} created.`]);
    setBusy(false);
    setDone(true);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/campfirelive/group/${groupId}`}
        className="text-sm text-slate-500 hover:text-orange-600"
      >
        ← Back to group
      </Link>
      <h1 className="mt-2 text-2xl font-extrabold text-slate-900">
        🎂 Bulk add birthdays
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        One per line:{" "}
        <span className="font-medium">Name, date, recipient</span> — e.g.{" "}
        <code>Laura, 1973-09-04, Laura</code>. The 3rd field is the{" "}
        <strong>&ldquo;All Except&rdquo;</strong> recipient the card is hidden from (a
        member&apos;s name, or an email). For little ones, change it to a{" "}
        <strong>parent</strong>; leave it blank to set per-card later. Each becomes a{" "}
        <strong>recurring</strong> card that auto-opens ~{LEAD_DAYS} days before the
        day. Review before creating — unmatched recipients are flagged in the log.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        className="mt-4 w-full rounded-xl border border-slate-300 p-3 font-mono text-sm outline-none focus:border-orange-500"
      />

      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-600">
          {parsed.length} valid
          {badLines.length > 0 && (
            <span className="text-rose-600"> · {badLines.length} can&apos;t parse</span>
          )}
        </span>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Copy birthday pictures from
        </label>
        {templates.length > 0 ? (
          <select
            value={coverFrom}
            onChange={(e) => setCoverFrom(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
          >
            <option value="">No pictures</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} ({t.urls.length} pic{t.urls.length === 1 ? "" : "s"})
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs text-slate-400">
            No existing birthday card with pictures to copy from — cards will have no
            cover art (you can add it per card later).
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={run}
          disabled={busy || parsed.length === 0}
          className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Creating…" : `Create ${parsed.length} recurring birthday cards`}
        </button>
        {done && (
          <button
            onClick={() => router.push(`/campfirelive/group/${groupId}`)}
            className="text-sm font-medium text-slate-600 hover:text-slate-800"
          >
            Back to group →
          </button>
        )}
      </div>

      {log.length > 0 && (
        <div className="mt-5 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs">
          {log.map((line, i) => (
            <div key={i} className="text-slate-700">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
