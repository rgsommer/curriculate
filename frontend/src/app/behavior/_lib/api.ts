// src/app/behavior/_lib/api.ts
//
// Thin client for the Behaviours API (backend /api/behavior). Reuses the
// existing Curriculate JWT stored by the login page in localStorage
// ("curriculate_auth_token"), so Behaviours shares the same sign-in.

const API_BASE =
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

  const res = await fetch(`${API_BASE}/api/behavior${path}`, {
    method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body,
  });

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
};

export type Behavior = {
  _id: string;
  name: string;
  keyword?: string;
  triggerMode: "THRESHOLD" | "IMMEDIATE" | "INTERACTION";
  consequenceText?: string;
  scope: "standard" | "custom";
};
