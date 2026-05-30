// POST → run automated analysis on uploaded files. Writes findings into
// `audit_findings` (replacing prior auto-generated ones for this engagement).
// Theresia reviews + edits findings before any client deliverable goes out.
//
// Phase 2 scope (this commit):
//   - TB total balance check (debits = credits)
//   - GL total balance check
//   - TB-vs-GL account-total reconciliation (top mismatches)
//   - Round-number transaction flagging (last 3 zeros)
//   - Weekend / holiday journal-posting detection (rough — uses ISO day-of-week)
//   - Duplicate transaction amounts on same date (potential double-posting)
//
// Out of scope (Phase 2b):
//   - PDF parsing (bank statements still need manual extraction)
//   - Related-party name matching against board minutes
//   - Ratio analysis vs prior year (needs prior-year TB upload)
//   - Compliance cross-check against TeebeePay payroll data
import { NextResponse } from "next/server";
import { GridFSBucket } from "mongodb";
import ExcelJS from "exceljs";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";

async function canAccess(dbi: any, u: any, engagementId: string): Promise<boolean> {
  if (u.clearance >= 3) return true;
  return false;
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

/* ── tiny tabular parser for XLSX or CSV ─────────────────────────── */
type Row = Record<string, any>;
async function parseFile(bucket: GridFSBucket, fileDoc: any): Promise<Row[]> {
  const chunks: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    const s = bucket.openDownloadStream(fileDoc._id);
    s.on("data", (c: Buffer) => chunks.push(c));
    s.on("end", () => resolve());
    s.on("error", reject);
  });
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const filename = String(fileDoc.filename || "").toLowerCase();
  if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
    const wb = new ExcelJS.Workbook();
    // Pass the underlying ArrayBuffer slice — ExcelJS accepts ArrayBuffer | Buffer,
    // and this dodges the Node 22 / @types/node Buffer<ArrayBuffer> vs Buffer
    // generic-typing mismatch that fails the Next.js production type-check.
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    await wb.xlsx.load(ab);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const header: string[] = [];
    const rows: Row[] = [];
    ws.eachRow((row, rowNumber) => {
      const values = (row.values as any[]).slice(1);
      if (rowNumber === 1) {
        for (const v of values) header.push(String(v ?? "").trim());
        return;
      }
      const obj: Row = {};
      for (let i = 0; i < header.length; i++) obj[header[i]] = values[i];
      rows.push(obj);
    });
    return rows;
  }
  if (filename.endsWith(".csv")) {
    const text = buf.toString("utf8");
    // Simple CSV parser — handles quoted fields but not multiline values
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    if (!lines.length) return [];
    const parseLine = (l: string): string[] => {
      const out: string[] = []; let cur = ""; let q = false;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (q) {
          if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') q = false;
          else cur += c;
        } else {
          if (c === '"') q = true;
          else if (c === ",") { out.push(cur); cur = ""; }
          else cur += c;
        }
      }
      out.push(cur);
      return out;
    };
    const header = parseLine(lines[0]).map((h) => h.trim());
    const rows: Row[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseLine(lines[i]);
      const obj: Row = {};
      for (let j = 0; j < header.length; j++) obj[header[j]] = cells[j];
      rows.push(obj);
    }
    return rows;
  }
  return []; // PDFs etc. not parsed in Phase 2
}

function pickColumn(rows: Row[], aliases: string[]): string | null {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0]).map((k) => k.toLowerCase());
  for (const alias of aliases) {
    const idx = keys.indexOf(alias.toLowerCase());
    if (idx >= 0) return Object.keys(rows[0])[idx];
  }
  return null;
}
function num(v: any): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[,\s$]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/* ── analysis runners ────────────────────────────────────────────── */
interface Finding {
  code: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  source_file?: string;
  evidence?: any;
  auto: true;
  status: "open";
}

function analyzeTrialBalance(rows: Row[], filename: string): Finding[] {
  const out: Finding[] = [];
  const debitCol = pickColumn(rows, ["Debit", "Dr", "debit", "DEBIT"]);
  const creditCol = pickColumn(rows, ["Credit", "Cr", "credit", "CREDIT"]);
  if (!debitCol && !creditCol) {
    const balCol = pickColumn(rows, ["Balance", "Amount", "balance"]);
    if (balCol) {
      const sum = rows.reduce((s, r) => s + num(r[balCol]), 0);
      if (Math.abs(sum) > 0.5) {
        out.push({
          code: "TB_BALANCE_NONZERO", severity: "high", auto: true, status: "open",
          title: `Trial balance net of ${r2(sum)} (should sum to zero)`,
          detail: `Single-column balance trial balance with non-zero net total. Investigate before completing fieldwork.`,
          source_file: filename, evidence: { net: r2(sum), rows: rows.length },
        });
      }
    }
    return out;
  }
  let dr = 0, cr = 0;
  for (const r of rows) {
    dr += num(debitCol ? r[debitCol] : 0);
    cr += num(creditCol ? r[creditCol] : 0);
  }
  const diff = r2(dr - cr);
  if (Math.abs(diff) > 0.5) {
    out.push({
      code: "TB_UNBALANCED", severity: "high", auto: true, status: "open",
      title: `Trial balance is out by ${r2(Math.abs(diff))}`,
      detail: `Debits total ${r2(dr).toLocaleString()}, credits total ${r2(cr).toLocaleString()}. Difference: ${diff > 0 ? "Dr exceeds Cr by " : "Cr exceeds Dr by "}${r2(Math.abs(diff)).toLocaleString()}. A trial balance MUST balance — this needs to be reconciled before audit work proceeds.`,
      source_file: filename, evidence: { debits: r2(dr), credits: r2(cr), diff },
    });
  } else {
    out.push({
      code: "TB_BALANCED", severity: "low", auto: true, status: "open",
      title: `Trial balance is in balance (Dr = Cr = ${r2(dr).toLocaleString()})`,
      detail: `${rows.length} accounts. Debits and credits agree to within ${r2(Math.abs(diff))}.`,
      source_file: filename, evidence: { debits: r2(dr), credits: r2(cr), accounts: rows.length },
    });
  }
  return out;
}

function analyzeGeneralLedger(rows: Row[], filename: string): Finding[] {
  const out: Finding[] = [];
  if (!rows.length) return out;

  const dateCol = pickColumn(rows, ["Date", "Posting date", "Trans date", "date", "trans_date"]);
  const debitCol = pickColumn(rows, ["Debit", "Dr", "debit"]);
  const creditCol = pickColumn(rows, ["Credit", "Cr", "credit"]);
  const amtCol  = pickColumn(rows, ["Amount", "Net", "amount"]);
  const accCol  = pickColumn(rows, ["Account", "Account name", "account", "Account No"]);
  const descCol = pickColumn(rows, ["Description", "Memo", "Reference", "description"]);

  // Balance check
  if (debitCol && creditCol) {
    let dr = 0, cr = 0;
    for (const r of rows) { dr += num(r[debitCol]); cr += num(r[creditCol]); }
    const diff = r2(dr - cr);
    if (Math.abs(diff) > 0.5) {
      out.push({
        code: "GL_UNBALANCED", severity: "high", auto: true, status: "open",
        title: `General ledger out of balance by ${r2(Math.abs(diff))}`,
        detail: `Sum of GL debits (${r2(dr).toLocaleString()}) does not equal sum of credits (${r2(cr).toLocaleString()}). Suggests incomplete export or unbalanced manual journals.`,
        source_file: filename, evidence: { debits: r2(dr), credits: r2(cr), diff, rows: rows.length },
      });
    }
  }

  // Round-number transactions (last 3 digits all zero, magnitude > 100)
  const rounds: any[] = [];
  for (const r of rows) {
    const amt = Math.abs(num(amtCol ? r[amtCol] : (debitCol ? r[debitCol] : 0)) || num(creditCol ? r[creditCol] : 0));
    if (amt >= 1000 && amt % 1000 === 0) {
      rounds.push({ date: dateCol ? r[dateCol] : null, account: accCol ? r[accCol] : null,
                     desc: descCol ? r[descCol] : null, amt });
    }
  }
  if (rounds.length) {
    const sample = rounds.slice(0, 8).map((r) => `${r.date || "?"} · ${r.account || "?"} · ${r2(r.amt).toLocaleString()}`).join(" • ");
    out.push({
      code: "GL_ROUND_NUMBERS", severity: rounds.length > 20 ? "medium" : "low", auto: true, status: "open",
      title: `${rounds.length} round-number transactions (≥1,000, multiple of 1,000)`,
      detail: `Round-number transactions can indicate management estimates rather than actual amounts. ` +
              `Worth checking the bigger ones. Sample: ${sample}${rounds.length > 8 ? ` … and ${rounds.length - 8} more` : ""}`,
      source_file: filename, evidence: { count: rounds.length, sample: rounds.slice(0, 50) },
    });
  }

  // Weekend postings (date parseable, day-of-week is Sat/Sun)
  if (dateCol) {
    const weekends: any[] = [];
    for (const r of rows) {
      const d = new Date(String(r[dateCol]));
      if (Number.isNaN(d.getTime())) continue;
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) {
        weekends.push({ date: r[dateCol], account: accCol ? r[accCol] : null,
                         desc: descCol ? r[descCol] : null });
      }
    }
    if (weekends.length) {
      out.push({
        code: "GL_WEEKEND_POSTINGS", severity: weekends.length > 10 ? "medium" : "low", auto: true, status: "open",
        title: `${weekends.length} journal entries posted on weekends`,
        detail: `Saturday/Sunday postings warrant a glance — they can indicate manual adjustments outside normal business hours. ` +
                `If your team operates 7 days, this is benign; otherwise review the largest amounts.`,
        source_file: filename, evidence: { count: weekends.length, sample: weekends.slice(0, 50) },
      });
    }
  }

  // Duplicate amounts on same date
  if (dateCol) {
    const buckets: Record<string, any[]> = {};
    for (const r of rows) {
      const amt = Math.abs(num(amtCol ? r[amtCol] : 0) || num(debitCol ? r[debitCol] : 0) || num(creditCol ? r[creditCol] : 0));
      if (amt <= 0) continue;
      const k = `${String(r[dateCol]).slice(0, 10)}|${r2(amt)}`;
      (buckets[k] = buckets[k] || []).push(r);
    }
    const dups = Object.entries(buckets).filter(([_, v]) => v.length >= 2);
    if (dups.length) {
      out.push({
        code: "GL_DUPLICATE_AMOUNTS", severity: dups.length > 5 ? "medium" : "low", auto: true, status: "open",
        title: `${dups.length} duplicate transaction amounts on the same date`,
        detail: `Two or more transactions with identical amounts on the same date. ` +
                `Sometimes legitimate (recurring payments), sometimes double-posting. Review the top occurrences.`,
        source_file: filename,
        evidence: { count: dups.length, sample: dups.slice(0, 30).map(([k, v]) => ({ key: k, count: v.length })) },
      });
    }
  }

  // Transaction count info finding (always)
  out.push({
    code: "GL_SUMMARY", severity: "low", auto: true, status: "open",
    title: `General ledger: ${rows.length.toLocaleString()} transactions parsed`,
    detail: `Imported ${rows.length} GL transaction rows from ${filename}. Columns detected: ${
      [dateCol, accCol, descCol, debitCol, creditCol, amtCol].filter(Boolean).join(", ")
    }.`,
    source_file: filename, evidence: { rows: rows.length },
  });
  return out;
}

function reconcileTBtoGL(tb: Row[], gl: Row[], tbFile: string, glFile: string): Finding[] {
  const out: Finding[] = [];
  const tbAccCol = pickColumn(tb, ["Account", "Account name", "account"]);
  const tbDr = pickColumn(tb, ["Debit", "Dr", "debit"]);
  const tbCr = pickColumn(tb, ["Credit", "Cr", "credit"]);
  const tbBal = pickColumn(tb, ["Balance", "Net", "Amount"]);
  const glAccCol = pickColumn(gl, ["Account", "Account name", "account"]);
  const glDr = pickColumn(gl, ["Debit", "Dr", "debit"]);
  const glCr = pickColumn(gl, ["Credit", "Cr", "credit"]);
  const glAmt = pickColumn(gl, ["Amount", "Net", "amount"]);
  if (!tbAccCol || !glAccCol) return out;

  const tbByAcc: Record<string, number> = {};
  for (const r of tb) {
    const acc = String(r[tbAccCol] || "").trim();
    if (!acc) continue;
    const bal = tbDr && tbCr ? num(r[tbDr]) - num(r[tbCr]) :
                tbBal ? num(r[tbBal]) : 0;
    tbByAcc[acc] = (tbByAcc[acc] || 0) + bal;
  }
  const glByAcc: Record<string, number> = {};
  for (const r of gl) {
    const acc = String(r[glAccCol] || "").trim();
    if (!acc) continue;
    const mvt = glDr && glCr ? num(r[glDr]) - num(r[glCr]) :
                glAmt ? num(r[glAmt]) : 0;
    glByAcc[acc] = (glByAcc[acc] || 0) + mvt;
  }
  const mismatches: any[] = [];
  for (const acc of Object.keys(tbByAcc)) {
    const tbVal = r2(tbByAcc[acc]);
    const glVal = r2(glByAcc[acc] || 0);
    const diff = r2(tbVal - glVal);
    if (Math.abs(diff) > 0.5) mismatches.push({ account: acc, tb: tbVal, gl: glVal, diff });
  }
  // Accounts in GL but not TB
  for (const acc of Object.keys(glByAcc)) {
    if (!(acc in tbByAcc) && Math.abs(glByAcc[acc]) > 0.5) {
      mismatches.push({ account: acc, tb: 0, gl: r2(glByAcc[acc]), diff: -r2(glByAcc[acc]) });
    }
  }
  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  if (mismatches.length) {
    const sample = mismatches.slice(0, 8).map((m) =>
      `${m.account}: TB ${m.tb.toLocaleString()} ≠ GL ${m.gl.toLocaleString()} (Δ ${m.diff.toLocaleString()})`).join(" • ");
    out.push({
      code: "TB_GL_MISMATCH", severity: "high", auto: true, status: "open",
      title: `${mismatches.length} account(s) where TB doesn't agree with GL`,
      detail: `Account-by-account, the trial balance and general ledger should reconcile. ` +
              `${mismatches.length} accounts differ by more than 50 toea. Largest: ${sample}` +
              (mismatches.length > 8 ? ` … and ${mismatches.length - 8} more` : ""),
      source_file: `${tbFile} ⇄ ${glFile}`,
      evidence: { mismatches: mismatches.slice(0, 100) },
    });
  } else {
    out.push({
      code: "TB_GL_AGREES", severity: "low", auto: true, status: "open",
      title: "Trial balance reconciles cleanly to general ledger",
      detail: `All ${Object.keys(tbByAcc).length} accounts in the TB tie to their GL totals (within 50 toea).`,
      source_file: `${tbFile} ⇄ ${glFile}`,
      evidence: { accounts: Object.keys(tbByAcc).length },
    });
  }
  return out;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const dbi = await db();
    if (!(await canAccess(dbi, u, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const eng: any = await dbi.collection("audit_engagements").findOne({ _id: new ObjectId(id) });
    if (!eng) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });

    const files: any[] = await dbi.collection("audit_files.files").find({
      "metadata.engagement_id": new ObjectId(id),
    }).toArray();
    const bucket = new GridFSBucket(dbi as any, { bucketName: "audit_files" });

    const tbFile = files.find((f) => f.metadata?.slot === "trial_balance");
    const glFile = files.find((f) => f.metadata?.slot === "general_ledger");
    const findings: Finding[] = [];
    let tbRows: Row[] = [], glRows: Row[] = [];

    if (tbFile) {
      try { tbRows = await parseFile(bucket, tbFile); }
      catch (e) { findings.push({ code: "TB_PARSE_FAILED", severity: "medium", auto: true, status: "open",
        title: `Could not parse trial balance file (${tbFile.filename})`,
        detail: `Parser failed: ${(e as any)?.message || "unknown"}. PDFs aren't supported in Phase 2; re-export as XLSX or CSV.`,
        source_file: tbFile.filename }); }
      findings.push(...analyzeTrialBalance(tbRows, tbFile.filename));
    } else {
      findings.push({ code: "TB_MISSING", severity: "medium", auto: true, status: "open",
        title: "No trial balance uploaded yet",
        detail: "Upload a year-end trial balance (XLSX or CSV) and re-run analysis. Most checks depend on it." });
    }
    if (glFile) {
      try { glRows = await parseFile(bucket, glFile); }
      catch (e) { findings.push({ code: "GL_PARSE_FAILED", severity: "medium", auto: true, status: "open",
        title: `Could not parse general ledger file (${glFile.filename})`,
        detail: `Parser failed: ${(e as any)?.message || "unknown"}.`,
        source_file: glFile.filename }); }
      findings.push(...analyzeGeneralLedger(glRows, glFile.filename));
    } else {
      findings.push({ code: "GL_MISSING", severity: "medium", auto: true, status: "open",
        title: "No general ledger uploaded yet",
        detail: "Without a GL we can't reconcile, sample, or detect anomalies. Most accounting packages export this." });
    }
    if (tbRows.length && glRows.length) {
      findings.push(...reconcileTBtoGL(tbRows, glRows, tbFile?.filename || "TB", glFile?.filename || "GL"));
    }

    // Replace prior auto-generated findings (preserve manual ones added by Theresia)
    await dbi.collection("audit_findings").deleteMany({
      engagement_id: new ObjectId(id), auto: true,
    });
    const docs = findings.map((f) => ({
      ...f, engagement_id: new ObjectId(id), created_at: new Date(),
    }));
    if (docs.length) await dbi.collection("audit_findings").insertMany(docs as any);

    await dbi.collection("audit_engagements").updateOne({ _id: eng._id }, {
      $set: {
        last_analysis_at: new Date(),
        last_analysis_by: u.email,
        last_findings_count: findings.length,
        ...(eng.status === "active" ? { status: "review" } : {}),
      },
    });

    return NextResponse.json({ ok: true, findings_count: findings.length });
  } catch (e: any) {
    console.error("[audit/analyze] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
