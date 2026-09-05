import crypto from "crypto";

// Read-only access to the teacher's planning spreadsheet for the /daily board.
//
// Two ways to authenticate, checked in this order:
//   1. DAILY_SHEETS_SERVICE_ACCOUNT — the JSON of a Google service account.
//      Share the spreadsheet (Viewer) with the account's client_email and the
//      sheet can stay private. Token is minted with Node crypto, no SDK needed
//      (same approach as lib/campfire/push.ts).
//   2. DAILY_SHEETS_API_KEY — a Google API key with the Sheets API enabled.
//      Only works when the spreadsheet is shared "Anyone with the link".
//
// DAILY_SHEET_ID selects the spreadsheet; it defaults to the planner this
// board was built for.

export const DEFAULT_SHEET_ID = "1Iyi53mBeFVGHsTdPnoTr7HdZ6whcNyAyui_LEGH_8go";

type ServiceAccount = { client_email: string; private_key: string };

let tokenCache: { token: string; exp: number } | null = null;

async function mintAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;

  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned =
    b64({ alg: "RS256", typ: "JWT" }) +
    "." +
    b64({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(sa.private_key, "base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" +
      `${unsigned}.${signature}`,
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token request failed: ${data.error || res.status}`);
  }
  tokenCache = { token: data.access_token, exp: now + 3600 };
  return data.access_token;
}

function readServiceAccount(): ServiceAccount | null {
  const raw = process.env.DAILY_SHEETS_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (sa && sa.client_email && sa.private_key) return sa;
  } catch {
    /* fall through */
  }
  return null;
}

export type RenderOption = "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";

/** Fetch several A1 ranges in one call. Returns one 2-D string array per range, in order. */
export async function readRanges(ranges: string[], render: RenderOption = "FORMATTED_VALUE"): Promise<string[][][]> {
  const sheetId = process.env.DAILY_SHEET_ID || DEFAULT_SHEET_ID;
  const params = new URLSearchParams();
  for (const r of ranges) params.append("ranges", r);
  params.set("valueRenderOption", render);
  params.set("majorDimension", "ROWS");

  const headers: Record<string, string> = { accept: "application/json" };
  const sa = readServiceAccount();
  if (sa) {
    headers.Authorization = `Bearer ${await mintAccessToken(sa)}`;
  } else if (process.env.DAILY_SHEETS_API_KEY) {
    params.set("key", process.env.DAILY_SHEETS_API_KEY);
  } else {
    throw new Error("Set DAILY_SHEETS_SERVICE_ACCOUNT or DAILY_SHEETS_API_KEY");
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${params}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as {
    valueRanges?: { values?: unknown[][] }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(`Sheets API ${res.status}: ${data.error?.message || "request failed"}`);
  }
  return (data.valueRanges || []).map((vr) =>
    (vr.values || []).map((row) => row.map((cell) => (cell == null ? "" : String(cell))))
  );
}
