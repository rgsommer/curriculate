// src/app/behavior/_lib/api.ts
//
// Thin client for the Behaviours API (backend /api/behavior). Reuses the
// existing Curriculate JWT stored by the login page in localStorage
// ("curriculate_auth_token"), so Behaviours shares the same sign-in.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://api.curriculate.net";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("curriculate_auth_token");
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

type ApiOptions = {
  method?: string;
  body?: any;
  isForm?: boolean;
  timeoutMs?: number; // abort after this long so the UI never hangs forever
};

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body; // browser sets multipart boundary
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let signal: AbortSignal | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeoutMs) {
    const ctrl = new AbortController();
    signal = ctrl.signal;
    timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/behavior${path}`, {
      method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body,
      signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new ApiError("Timed out — please try again.", 0, null);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    // An expired/invalid session shouldn't dead-end on a red error the teacher
    // can't act on: drop the stale token and send them to sign in again,
    // returning to the page they were on.
    if (res.status === 401 && typeof window !== "undefined") {
      try {
        localStorage.removeItem("curriculate_auth_token");
      } catch {
        /* storage unavailable — fall through to the redirect anyway */
      }
      const here = window.location.pathname + window.location.search;
      if (!here.startsWith("/login")) window.location.href = loginHref(here);
    }
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
  }
  return data as T;
}

export const loginHref = (returnTo: string) =>
  `/login?returnTo=${encodeURIComponent(returnTo)}`;

// ── Shared types (subset used by the UI) ─────────────────────────────────────

export type Membership = {
  _id: string;
  schoolId: string;
  role: "originator" | "admin" | "teacher" | "principal";
  name: string;
  email: string;
  housesCommittee?: boolean;
  homeworkPrefs?: { lateWeeks?: number | null; outstandingBelow?: number | null };
};

export type Me = {
  ok: boolean;
  membership: Membership | null;
  needsSetup?: boolean;
  school?: { _id: string; name: string; emailDomain: string };
  config?: any;
  admins?: Array<{ name?: string; email?: string; role?: string }>;
};

export type StudentSummary = {
  _id: string;
  lastName: string;
  firstName: string;
  preferredName?: string;
  classGroup?: string;
  grade?: string;
  gender?: string;
  activeCount?: number;
  noticesHomeCount?: number;
  guddCount?: number;
  houseId?: string | null;
  houseGroup?: number;
  behaviourConcern?: boolean;
  sportsSkilled?: boolean;
  academic?: boolean;
  // Id of a recommended-but-not-yet-issued white slip (null if none) — drives the
  // "White slip — issued? Yes" indicator any teacher can confirm.
  pendingWhiteSlipId?: string | null;
  // Consequences given but not yet marked done — a dashboard "Mark done" to-do.
  pendingConsequences?: { id: string; type: string }[];
  // Whether a homeroom follow-up has been logged for this student this week.
  hrFollowedUpThisWeek?: boolean;
};

export type ParentTemplate = { name: string; body: string; kind?: "encouraging" | "corrective" };

// The signed-in teacher's parent-message templates + subject label (seeded with
// generalized defaults server-side when the teacher hasn't saved any).
export function getMyTemplates() {
  return api<{ subject: string; templates: ParentTemplate[]; teacherName: string }>("/my-templates");
}
export function saveMyTemplates(body: { subject?: string; templates?: ParentTemplate[] }) {
  return api<{ subject: string; templates: ParentTemplate[] }>("/my-templates", { method: "PUT", body });
}
// Build a parent message for a student from a template, log it, and return the
// filled text to copy. The teacher sends it themselves.
export function generateParentMessage(studentId: string, name: string, force = false, newStudent = false) {
  return api<{ message?: string; html?: string; template: string; duplicate?: boolean; lastSentAt?: string }>(
    `/students/${studentId}/parent-message`, { method: "POST", body: { name, force, newStudent } });
}
// Bulk: email the teacher one personalised message per selected student and log
// each separately. Encouraging duplicates within a year are skipped (reported in
// `skipped`) unless force is set.
export function bulkParentMessage(name: string, studentIds: string[], force = false, newStudent = false) {
  return api<{ template: string; requested: number; matched: number; sent: number; logged: number; skipped: { id: string; name: string }[]; to: string }>(
    "/parent-message/bulk", { method: "POST", body: { name, studentIds, force, newStudent } });
}

// Resolve a recommended white slip (any teacher may click). Omit `other` to
// confirm it was issued; pass `other` to record that a different consequence was
// given instead (logged as its own consequence).
export function issueWhiteSlip(consequenceId: string, other?: string) {
  return api(`/consequences/${consequenceId}/issue`, { method: "POST", body: other ? { other } : {} });
}

// Mark a consequence completed (or undo). Any teacher can confirm follow-through.
export function completeConsequence(consequenceId: string, completed = true) {
  return api(`/consequences/${consequenceId}/complete`, { method: "POST", body: { completed } });
}

// Log a homeroom follow-up (supportive relational check-in) for a student.
export function homeroomFollowup(studentId: string) {
  return api(`/students/${studentId}/homeroom-followup`, { method: "POST", body: {} });
}

// GUDD (Good Uniform Dress Down) status for a student.
export type GuddStatus = {
  enabled: boolean;
  name: string;
  count: number;
  threshold: number;
  fadeDays?: number;
  lost: boolean;
  atRisk: boolean;
  consequence?: string;
  nextConsequence?: string;
};

export type Behavior = {
  _id: string;
  name: string;
  keyword?: string;
  triggerMode: "THRESHOLD" | "IMMEDIATE" | "INTERACTION";
  consequenceText?: string;
  scope: "standard" | "custom";
  uniform?: boolean;
  categories?: string[];
  immediateWhiteSlip?: boolean;
  points?: number;
  kind?: "negative" | "positive";
};
