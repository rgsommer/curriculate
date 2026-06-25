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
  activeCount?: number;
  noticesHomeCount?: number;
  guddCount?: number;
  houseId?: string | null;
  houseGroup?: number;
  behaviourConcern?: boolean;
  sportsSkilled?: boolean;
  academic?: boolean;
};

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
