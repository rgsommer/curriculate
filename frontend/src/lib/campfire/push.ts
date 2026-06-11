import crypto from "crypto";

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

// Returns a sender, or null when FCM isn't configured (so callers no-op silently).
// Mints the access token ONCE so a whole cron run reuses it.
export async function createPushSender(): Promise<PushSender | null> {
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
  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

  return async (token, p) => {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
      return res.ok;
    } catch {
      return false;
    }
  };
}
