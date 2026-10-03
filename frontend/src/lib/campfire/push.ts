import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// Firebase Cloud Messaging (HTTP v1) sender, built from a service-account JSON in
// the FCM_SERVICE_ACCOUNT env var. FCM delivers to both Android and iOS (when the
// iOS app is set up with Firebase). The legacy server-key API is gone, so v1 needs
// an OAuth access token minted from the service account — done here with Node crypto,
// no extra dependencies.

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};

async function mintAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned =
    b64({ alg: "RS256", typ: "JWT" }) +
    "." +
    b64({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(sa.private_key, "base64url");
  const jwt = `${unsigned}.${signature}`;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:
        "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + jwt,
    });
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

export type PushPayload = { title: string; body: string; link?: string };
export type PushSender = (token: string, p: PushPayload) => Promise<boolean>;

type FcmContext = { accessToken: string; endpoint: string };

// Build the FCM context (OAuth token + endpoint), or null when unconfigured.
async function fcmContext(): Promise<FcmContext | null> {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(raw);
  } catch {
    return null;
  }
  const accessToken = await mintAccessToken(sa);
  if (!accessToken) return null;
  return {
    accessToken,
    endpoint: `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
  };
}

// Send one message. "invalid" = the token is dead (unregistered) and should be pruned.
async function sendOne(
  ctx: FcmContext,
  token: string,
  p: PushPayload
): Promise<"ok" | "invalid" | "error"> {
  try {
    const res = await fetch(ctx.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        "Content-Type": "application/json",
      },
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

// Returns a sender, or null when FCM isn't configured (so callers no-op silently).
// Mints the access token ONCE so a whole cron run reuses it.
export async function createPushSender(): Promise<PushSender | null> {
  const ctx = await fcmContext();
  if (!ctx) return null;
  return async (token, p) => (await sendOne(ctx, token, p)) === "ok";
}

// Push to a set of users (by user id) across all their devices. Self-contained:
// no-ops silently when FCM isn't configured, and prunes dead tokens as it goes.
// This is the one call event handlers use.
export async function pushToUsers(
  userIds: string[],
  p: PushPayload
): Promise<number> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return 0;
  const ctx = await fcmContext();
  if (!ctx) return 0; // FCM not configured yet → safe no-op
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 0;
  const admin = createClient(url, key);
  const { data: toks } = await admin
    .from("campfire_push_tokens")
    .select("token")
    .in("user_id", ids);
  let sent = 0;
  for (const row of toks ?? []) {
    const tok = (row as { token: string }).token;
    const r = await sendOne(ctx, tok, p);
    if (r === "ok") sent++;
    else if (r === "invalid") {
      await admin.from("campfire_push_tokens").delete().eq("token", tok);
    }
  }
  return sent;
}
