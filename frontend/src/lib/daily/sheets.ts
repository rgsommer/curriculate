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

/**
 * One batch read that survives a range naming a tab that is not there.
 *
 * `values:batchGet` fails the whole batch if any range is unparseable, and the
 * board asks for a dozen ranges across half the workbook. So a 400 triggers a
 * one-off probe of each range; the offenders are remembered and left out of
 * every later batch. Quota and auth errors are not swallowed - they have to
 * reach the caller so it can back off.
 *
 * Returns one grid per requested range, in order, empty for the ones that are
 * known to be missing.
 */
const badRanges = new Set<string>();

export async function readRangesSafe(
  ranges: string[],
  render: RenderOption = "FORMATTED_VALUE"
): Promise<string[][][]> {
  const wanted = ranges.filter((r) => !badRanges.has(r));
  if (!wanted.length) return ranges.map(() => [] as string[][]);
  let got: string[][][];
  try {
    got = await readRanges(wanted, render);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (!/Sheets API 400/.test(msg)) throw e;
    got = [];
    for (const r of wanted) {
      try {
        got.push((await readRanges([r], render))[0] || []);
      } catch {
        badRanges.add(r);
        got.push([]);
      }
    }
  }
  const byRange = new Map(wanted.map((r, i) => [r, got[i] || ([] as string[][])]));
  return ranges.map((r) => byRange.get(r) || ([] as string[][]));
}

/**
 * The links in a range, read from the grid itself, in one request.
 *
 * A link in Sheets comes in two forms: a `=HYPERLINK()` formula, which shows up
 * in a FORMULA read, and a rich-text link applied to the cell's text with
 * Insert > Link, which appears in neither the value nor the formula. Both live
 * in the grid, so the grid is what gets read.
 *
 * `first` is one URL per cell ("" where there is none), which is what the
 * "Pray for ..." line needs. `runs` is every link in each cell paired with the
 * words it is attached to, which is what a lesson cell's handouts need. They
 * used to be two calls against the same range; the board is close enough to the
 * Sheets read quota that they are now one.
 */
export type GridLinks = { first: string[][]; runs: { text: string; url: string }[][][] };

export async function readGridLinks(range: string): Promise<GridLinks> {
  const sheetId = process.env.DAILY_SHEET_ID || DEFAULT_SHEET_ID;
  const params = new URLSearchParams();
  params.set("ranges", range);
  params.set("includeGridData", "true");
  params.set(
    "fields",
    "sheets.data.rowData.values(formattedValue,hyperlink,textFormatRuns(startIndex,format.link.uri),userEnteredFormat.textFormat.link.uri)"
  );

  const headers: Record<string, string> = { accept: "application/json" };
  const sa = readServiceAccount();
  if (sa) {
    headers.Authorization = `Bearer ${await mintAccessToken(sa)}`;
  } else if (process.env.DAILY_SHEETS_API_KEY) {
    params.set("key", process.env.DAILY_SHEETS_API_KEY);
  } else {
    throw new Error("Set DAILY_SHEETS_SERVICE_ACCOUNT or DAILY_SHEETS_API_KEY");
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?${params}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as {
    sheets?: {
      data?: {
        rowData?: {
          values?: {
            formattedValue?: string;
            hyperlink?: string;
            textFormatRuns?: { startIndex?: number; format?: { link?: { uri?: string } } }[];
            userEnteredFormat?: { textFormat?: { link?: { uri?: string } } };
          }[];
        }[];
      }[];
    }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${data.error?.message || "request failed"}`);

  const rows = data.sheets?.[0]?.data?.[0]?.rowData || [];
  const first: string[][] = [];
  const runs: { text: string; url: string }[][][] = [];
  rows.forEach((row) => {
    const firstRow: string[] = [];
    const runRow: { text: string; url: string }[][] = [];
    (row.values || []).forEach((cell) => {
      const value = cell.formattedValue || "";
      const cellRuns: { text: string; url: string }[] = [];
      (cell.textFormatRuns || []).forEach((run, i) => {
        const uri = run.format?.link?.uri;
        if (!uri) return;
        const from = run.startIndex || 0;
        const to = (cell.textFormatRuns || [])[i + 1]?.startIndex ?? value.length;
        cellRuns.push({ text: value.slice(from, to).trim(), url: uri });
      });
      if (!cellRuns.length && cell.hyperlink) cellRuns.push({ text: value.trim(), url: cell.hyperlink });
      firstRow.push(
        cell.hyperlink || cellRuns[0]?.url || cell.userEnteredFormat?.textFormat?.link?.uri || ""
      );
      runRow.push(cellRuns);
    });
    first.push(firstRow);
    runs.push(runRow);
  });
  return { first, runs };
}

/**
 * The spreadsheet's tab names.
 *
 * The Kiss & Ride list lives on its own tab, and the board should keep working
 * if that tab is renamed, so it is found by name at read time rather than
 * hard-coded into a range.
 */
let titleCache: { at: number; titles: string[] } | null = null;
const TITLE_TTL_MS = 60 * 60 * 1000;

export async function listSheetTitles(): Promise<string[]> {
  if (titleCache && Date.now() - titleCache.at < TITLE_TTL_MS) return titleCache.titles;
  const sheetId = process.env.DAILY_SHEET_ID || DEFAULT_SHEET_ID;
  const params = new URLSearchParams();
  params.set("fields", "sheets.properties.title");

  const headers: Record<string, string> = { accept: "application/json" };
  const sa = readServiceAccount();
  if (sa) {
    headers.Authorization = `Bearer ${await mintAccessToken(sa)}`;
  } else if (process.env.DAILY_SHEETS_API_KEY) {
    params.set("key", process.env.DAILY_SHEETS_API_KEY);
  } else {
    throw new Error("Set DAILY_SHEETS_SERVICE_ACCOUNT or DAILY_SHEETS_API_KEY");
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?${params}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as {
    sheets?: { properties?: { title?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${data.error?.message || "request failed"}`);
  const titles = (data.sheets || []).map((sh) => sh.properties?.title || "").filter(Boolean);
  titleCache = { at: Date.now(), titles };
  return titles;
}

