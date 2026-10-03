import crypto from "crypto";
import http2 from "http2";
import { createClient } from "@supabase/supabase-js";

// Native push for Campfire, routed by the token's platform:
//   • iOS     → straight to Apple (APNs HTTP/2, token auth with the .p8 key). No Firebase
//               on iOS at all — the app hands Capacitor the raw APNs device token.
//   • Android → Firebase Cloud Messaging HTTP v1 (service-account OAuth).
// Each side is configured by env vars and silently no-ops until they're set, so event
// wiring can ship before the credentials exist.
//
// APNs env: APNS_KEY (the .p8 file contents), APNS_KEY_ID, APNS_TEAM_ID (default
//           8XSHU49K2X), APNS_BUNDLE_ID (default net.curriculate.campfire).
// FCM env:  FCM_SERVICE_ACCOUNT (one-line service-account JSON).

export type PushPayload = { title: string; body: string; link?: string };
type Result = "ok" | "invalid" | "error";

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

// ─────────────────────────── Android: FCM HTTP v1 ───────────────────────────

type ServiceAccount = { client_email: string; private_key: string; project_id: string };
type FcmContext = { accessToken: string; endpoint: string };

async function fcmContext(): Promise<FcmContext | null> {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(raw);
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64url({ alg: "RS256", typ: "JWT" }) +
    "." +
    b64url({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const jwt = `${unsigned}.${signer.sign(sa.private_key, "base64url")}`;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + jwt,
    });
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) return null;
    return {
      accessToken: data.access_token,
      endpoint: `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    };
  } catch {
    return null;
  }
}

async function sendFcm(ctx: FcmContext, token: string, p: PushPayload): Promise<Result> {
  try {
    const res = await fetch(ctx.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: p.title, body: p.body },
          ...(p.link ? { data: { link: p.link } } : {}),
        },
      }),
    });
    if (res.ok) return "ok";
    // FCM returns 404 (UNREGISTERED) / 400 (invalid token) for dead tokens.
    if (res.status === 404 || res.status === 400) return "invalid";
    return "error";
  } catch {
    return "error";
  }
}

// ───────────────────────────── iOS: APNs HTTP/2 ─────────────────────────────

const APNS_HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com", // Xcode debug builds
} as const;

type ApnsConfig = { jwt: string; topic: string };

// Apple's provider token: ES256 JWT, valid up to an hour (cached ~50 min).
let apnsJwtCache: { jwt: string; at: number } | null = null;
function apnsConfig(): ApnsConfig | null {
  const key = (process.env.APNS_KEY || "").replace(/\\n/g, "\n").trim();
  const keyId = (process.env.APNS_KEY_ID || "").trim();
  const teamId = (process.env.APNS_TEAM_ID || "8XSHU49K2X").trim();
  const topic = (process.env.APNS_BUNDLE_ID || "net.curriculate.campfire").trim();
  if (!key || !keyId) return null;
  const now = Date.now();
  if (!apnsJwtCache || now - apnsJwtCache.at > 50 * 60 * 1000) {
    try {
      const unsigned =
        b64url({ alg: "ES256", kid: keyId }) +
        "." +
        b64url({ iss: teamId, iat: Math.floor(now / 1000) });
      const sig = crypto.sign("sha256", Buffer.from(unsigned), {
        key,
        dsaEncoding: "ieee-p1363", // JOSE wants raw r||s, not DER
      });
      apnsJwtCache = { jwt: `${unsigned}.${sig.toString("base64url")}`, at: now };
    } catch {
      return null; // malformed key
    }
  }
  return { jwt: apnsJwtCache.jwt, topic };
}

function apnsRequest(
  session: http2.ClientHttp2Session,
  cfg: ApnsConfig,
  token: string,
  p: PushPayload
): Promise<{ status: number; reason: string }> {
  return new Promise((resolve) => {
    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${cfg.jwt}`,
      "apns-topic": cfg.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let body = "";
    req.setTimeout(10000, () => req.close(http2.constants.NGHTTP2_CANCEL));
    req.on("response", (h) => (status = Number(h[":status"]) || 0));
    req.setEncoding("utf8");
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let reason = "";
      try {
        reason = (JSON.parse(body) as { reason?: string }).reason ?? "";
      } catch {
        /* empty body on success */
      }
      resolve({ status, reason });
    });
    req.on("error", () => resolve({ status: 0, reason: "network" }));
    req.end(
      JSON.stringify({
        aps: { alert: { title: p.title, body: p.body }, sound: "default" },
        ...(p.link ? { link: p.link } : {}),
      })
    );
  });
}

// One HTTP/2 connection per host, opened lazily and closed after the batch.
class ApnsSender {
  private sessions = new Map<string, http2.ClientHttp2Session>();
  constructor(private cfg: ApnsConfig) {}
  private session(host: string) {
    let s = this.sessions.get(host);
    if (!s || s.closed || s.destroyed) {
      s = http2.connect(host);
      s.on("error", () => {});
      this.sessions.set(host, s);
    }
    return s;
  }
  async send(token: string, p: PushPayload): Promise<Result> {
    const prod = await apnsRequest(this.session(APNS_HOSTS.production), this.cfg, token, p);
    if (prod.status === 200) return "ok";
    // A token from an Xcode debug build is only valid on the sandbox gateway.
    if (prod.status === 400 && prod.reason === "BadDeviceToken") {
      const sb = await apnsRequest(this.session(APNS_HOSTS.sandbox), this.cfg, token, p);
      if (sb.status === 200) return "ok";
      if (sb.status === 400 && sb.reason === "BadDeviceToken") return "invalid";
      return sb.status === 410 ? "invalid" : "error";
    }
    if (prod.status === 410) return "invalid"; // Unregistered — app removed
    return "error";
  }
  close() {
    this.sessions.forEach((s) => s.close());
    this.sessions.clear();
  }
}

// ───────────────────────────────── Public API ─────────────────────────────────

// Push to a set of users (by user id) across all their devices. Self-contained: no-ops
// for any platform that isn't configured yet, and prunes dead tokens as it goes.
// Returns the number of devices reached. This is the one call event handlers use.
export async function pushToUsers(userIds: string[], p: PushPayload): Promise<number> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return 0;
  const apns = apnsConfig();
  const hasFcm = !!process.env.FCM_SERVICE_ACCOUNT;
  if (!apns && !hasFcm) return 0; // nothing configured yet → safe no-op

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 0;
  const admin = createClient(url, key);
  const { data: toks } = await admin
    .from("campfire_push_tokens")
    .select("token, platform")
    .in("user_id", ids);
  const rows = (toks ?? []) as { token: string; platform: string | null }[];
  if (rows.length === 0) return 0;

  // Older rows predate the platform column being set; an APNs token is 64 hex chars.
  const isIos = (r: { token: string; platform: string | null }) =>
    r.platform === "ios" || (!r.platform && /^[0-9a-f]{64}$/i.test(r.token));

  const fcm = hasFcm && rows.some((r) => !isIos(r)) ? await fcmContext() : null;
  const apnsSender = apns && rows.some(isIos) ? new ApnsSender(apns) : null;

  let sent = 0;
  try {
    for (const r of rows) {
      let res: Result | null = null;
      if (isIos(r)) res = apnsSender ? await apnsSender.send(r.token, p) : null;
      else res = fcm ? await sendFcm(fcm, r.token, p) : null;
      if (res === "ok") sent++;
      else if (res === "invalid") {
        await admin.from("campfire_push_tokens").delete().eq("token", r.token);
      }
    }
  } finally {
    apnsSender?.close();
  }
  return sent;
}
