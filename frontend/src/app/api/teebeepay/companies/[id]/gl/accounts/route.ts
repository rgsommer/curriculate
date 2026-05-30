// Chart of accounts for one company.
//   GET  → seed the default chart on first access, then list every account
//          with its current balance (debit/credit totals + natural balance).
//   POST → create a custom account (bookkeeper+).
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../_auth";
import {
  ACCOUNT_TYPES, defaultNormalBalance, seedChartOfAccounts,
  accountTotals, naturalBalance,
} from "../../../../_ledger";

function gate(u: any, id: string) {
  if (!u) return { error: "Unauthorized", status: 401 };
  if (u.clearance < 3 && u.company_id !== id) return { error: "Forbidden", status: 403 };
  if (u.clearance < 2) return { error: "Forbidden", status: 403 };
  return null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  const { id } = await params;
  const g = gate(u, id);
  if (g) return NextResponse.json({ error: g.error }, { status: g.status });
  try {
    const dbi = await db();
    const cid = new ObjectId(id);
    await seedChartOfAccounts(dbi, cid);
    const [accounts, totals] = await Promise.all([
      dbi.collection("accounts").find({ company_id: cid }).sort({ code: 1 }).toArray(),
      accountTotals(dbi, cid, {}),
    ]);
    const rows = accounts.map((a: any) => {
      const t = totals.get(a._id.toString());
      return {
        id: a._id.toString(),
        code: a.code, name: a.name, type: a.type, subtype: a.subtype || null,
        normal_balance: a.normal_balance, contra: !!a.contra,
        is_system: !!a.is_system, is_active: a.is_active !== false,
        debit: t ? t.debit : 0, credit: t ? t.credit : 0,
        balance: naturalBalance(a, t),
      };
    });
    return NextResponse.json({ accounts: rows });
  } catch (e: any) {
    console.error("[teebeepay/gl/accounts GET] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  const { id } = await params;
  const g = gate(u, id);
  if (g) return NextResponse.json({ error: g.error }, { status: g.status });

  const b = await req.json().catch(() => ({} as any));
  const code = String(b.code || "").trim();
  const name = String(b.name || "").trim();
  const type = String(b.type || "");
  if (!/^\d{3,6}$/.test(code)) return NextResponse.json({ error: "Account code must be 3–6 digits." }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ error: "Account name is required." }, { status: 400 });
  if (!ACCOUNT_TYPES.includes(type as any)) return NextResponse.json({ error: "Invalid account type." }, { status: 400 });

  try {
    const dbi = await db();
    const cid = new ObjectId(id);
    const exists = await dbi.collection("accounts").findOne({ company_id: cid, code });
    if (exists) return NextResponse.json({ error: `Account code ${code} already exists.` }, { status: 409 });
    const contra = !!b.contra;
    const doc = {
      company_id: cid, code, name, type,
      subtype: String(b.subtype || "").trim() || null,
      normal_balance: contra
        ? (defaultNormalBalance(type) === "debit" ? "credit" : "debit")
        : defaultNormalBalance(type),
      contra, is_system: false, is_active: true,
      description: String(b.description || "").trim() || null,
      created_at: new Date(), created_by: u!.email,
    };
    const r = await dbi.collection("accounts").insertOne(doc);
    return NextResponse.json({ ok: true, id: r.insertedId.toString() });
  } catch (e: any) {
    console.error("[teebeepay/gl/accounts POST] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
