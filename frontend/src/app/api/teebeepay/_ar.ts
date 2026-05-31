// Accounts Receivable — customers, invoices, and the GL postings they drive.
//
// Lifecycle of an invoice:
//   draft  → (issue)  → issued → (pay) → paid
//                    ↘ (void) → void
//
// Issuing posts the sale into the ledger:
//   DR 1100 Accounts Receivable   total (subtotal + GST)
//      CR 4000 Sales Revenue            subtotal
//      CR 2100 GST/VAT Payable          gst
//
// Recording a payment clears the receivable into the bank:
//   DR 1010 Bank — Operating      amount
//      CR 1100 Accounts Receivable      amount
//
// Voiding an issued invoice reverses its sale entry. Every figure is run
// through round2() so float dust never unbalances a journal.
import type { Db } from "mongodb";
import { ObjectId } from "./_auth";
import { ensureAccount, postJournalEntry, reverseJournalEntry, round2 } from "./_ledger";

export const GST_RATE = 0.1;

function oid(v: string | ObjectId): ObjectId {
  return v instanceof ObjectId ? v : new ObjectId(String(v));
}

// Per-company sequential invoice number (INV-00001, …).
async function nextInvoiceNo(db: Db, companyId: ObjectId): Promise<number> {
  const res: any = await db.collection("gl_counters").findOneAndUpdate(
    { company_id: companyId, name: "invoice" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  return (res && (res.value ? res.value.seq : res.seq)) || 1;
}

export type InvoiceLineInput = {
  description?: string;
  quantity?: any;
  unit_price?: any;
  taxable?: boolean;
};

// Normalise raw line input and compute subtotal / GST / total. GST applies only
// to lines flagged taxable (defaults to taxable).
export function computeInvoiceTotals(rawLines: InvoiceLineInput[]) {
  const lines = (rawLines || []).map((l) => {
    const quantity = Number(l.quantity) || 0;
    const unit_price = round2(l.unit_price);
    const amount = round2(quantity * unit_price);
    const taxable = l.taxable !== false;
    return { description: (l.description || "").trim() || null, quantity, unit_price, amount, taxable };
  }).filter((l) => l.amount !== 0 || l.description);

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const taxableBase = round2(lines.filter((l) => l.taxable).reduce((s, l) => s + l.amount, 0));
  const gst = round2(taxableBase * GST_RATE);
  const total = round2(subtotal + gst);
  return { lines, subtotal, gst, total };
}

export async function createCustomer(
  db: Db, companyId: string | ObjectId,
  data: { name: string; email?: string; phone?: string; address?: string },
  createdBy?: string | ObjectId | null,
) {
  const cid = oid(companyId);
  const name = (data.name || "").trim();
  if (!name) throw new Error("Customer name is required.");
  const doc: any = {
    company_id: cid, name,
    email: (data.email || "").trim() || null,
    phone: (data.phone || "").trim() || null,
    address: (data.address || "").trim() || null,
    created_by: createdBy ? oid(createdBy) : null,
    created_at: new Date(),
  };
  const r = await db.collection("ar_customers").insertOne(doc);
  doc._id = r.insertedId;
  return doc;
}

export async function createInvoice(
  db: Db, companyId: string | ObjectId,
  data: { customer_id: string | ObjectId; date?: string; due_date?: string; lines: InvoiceLineInput[]; notes?: string },
  createdBy?: string | ObjectId | null,
) {
  const cid = oid(companyId);
  const customer: any = await db.collection("ar_customers").findOne({ _id: oid(data.customer_id), company_id: cid });
  if (!customer) throw new Error("Customer not found for this company.");

  const { lines, subtotal, gst, total } = computeInvoiceTotals(data.lines);
  if (lines.length === 0) throw new Error("An invoice needs at least one line.");

  const seq = await nextInvoiceNo(db, cid);
  const now = new Date();
  const doc: any = {
    company_id: cid,
    customer_id: customer._id,
    customer_name: customer.name,
    invoice_no: seq,
    invoice_ref: "INV-" + String(seq).padStart(5, "0"),
    date: data.date || now.toISOString().slice(0, 10),
    due_date: data.due_date || null,
    lines, subtotal, gst, total,
    amount_paid: 0,
    status: "draft",
    notes: (data.notes || "").trim() || null,
    gl_entry_id: null, gl_entry_ref: null,
    created_by: createdBy ? oid(createdBy) : null,
    created_at: now,
  };
  const r = await db.collection("ar_invoices").insertOne(doc);
  doc._id = r.insertedId;
  return doc;
}

// Issue a draft invoice: post the sale to the GL and flip status → issued.
export async function issueInvoice(
  db: Db, companyId: string | ObjectId, invoiceId: string | ObjectId,
  createdBy?: string | ObjectId | null,
) {
  const cid = oid(companyId);
  const inv: any = await db.collection("ar_invoices").findOne({ _id: oid(invoiceId), company_id: cid });
  if (!inv) throw new Error("Invoice not found.");
  if (inv.status !== "draft") throw new Error(`Only a draft invoice can be issued (this one is ${inv.status}).`);

  const [ar, sales, gstPayable] = await Promise.all([
    ensureAccount(db, cid, { code: "1100", name: "Accounts Receivable", type: "asset", subtype: "accounts_receivable" }),
    ensureAccount(db, cid, { code: "4000", name: "Sales Revenue", type: "revenue", subtype: "income" }),
    ensureAccount(db, cid, { code: "2100", name: "GST/VAT Payable", type: "liability", subtype: "tax" }),
  ]);

  const lines: any[] = [
    { account_id: ar!._id, description: `${inv.invoice_ref} ${inv.customer_name}`, debit: inv.total, credit: 0 },
    { account_id: sales!._id, description: "Sales", debit: 0, credit: inv.subtotal },
  ];
  if (inv.gst > 0) lines.push({ account_id: gstPayable!._id, description: "GST on sales", debit: 0, credit: inv.gst });

  const entry = await postJournalEntry(db, cid, {
    date: inv.date,
    memo: `Invoice ${inv.invoice_ref} — ${inv.customer_name}`,
    reference: inv.invoice_ref,
    source: "ar",
    lines,
    created_by: createdBy ?? null,
  });

  await db.collection("ar_invoices").updateOne(
    { _id: inv._id },
    { $set: { status: "issued", gl_entry_id: entry._id, gl_entry_ref: entry.entry_ref, issued_at: new Date() } },
  );
  return { invoice: { ...inv, status: "issued", gl_entry_ref: entry.entry_ref }, entry };
}

// Record a (full or partial) payment against an issued invoice.
export async function recordPayment(
  db: Db, companyId: string | ObjectId, invoiceId: string | ObjectId,
  data: { amount?: any; date?: string; bank_code?: string },
  createdBy?: string | ObjectId | null,
) {
  const cid = oid(companyId);
  const inv: any = await db.collection("ar_invoices").findOne({ _id: oid(invoiceId), company_id: cid });
  if (!inv) throw new Error("Invoice not found.");
  if (inv.status !== "issued") throw new Error(`Only an issued invoice can take a payment (this one is ${inv.status}).`);

  const outstanding = round2(inv.total - (inv.amount_paid || 0));
  const amount = data.amount == null ? outstanding : round2(data.amount);
  if (amount <= 0) throw new Error("Payment amount must be positive.");
  if (amount > outstanding) throw new Error(`Payment ${amount} exceeds the outstanding ${outstanding}.`);

  const [bank, ar] = await Promise.all([
    ensureAccount(db, cid, { code: data.bank_code || "1010", name: "Bank — Operating", type: "asset", subtype: "bank" }),
    ensureAccount(db, cid, { code: "1100", name: "Accounts Receivable", type: "asset", subtype: "accounts_receivable" }),
  ]);

  const entry = await postJournalEntry(db, cid, {
    date: data.date || new Date().toISOString().slice(0, 10),
    memo: `Payment for ${inv.invoice_ref} — ${inv.customer_name}`,
    reference: inv.invoice_ref,
    source: "ar",
    lines: [
      { account_id: bank!._id, description: "Customer payment", debit: amount, credit: 0 },
      { account_id: ar!._id, description: `${inv.invoice_ref} settled`, debit: 0, credit: amount },
    ],
    created_by: createdBy ?? null,
  });

  const amountPaid = round2((inv.amount_paid || 0) + amount);
  const fullyPaid = amountPaid >= inv.total;
  await db.collection("ar_invoices").updateOne(
    { _id: inv._id },
    {
      $set: { amount_paid: amountPaid, status: fullyPaid ? "paid" : "issued", ...(fullyPaid ? { paid_at: new Date() } : {}) },
      $push: { payments: { amount, date: data.date || new Date().toISOString().slice(0, 10), entry_id: entry._id, entry_ref: entry.entry_ref } },
    } as any,
  );
  return { entry, amountPaid, status: fullyPaid ? "paid" : "issued" };
}

// Void an invoice. A draft just flips status; an issued (unpaid) invoice also
// reverses its sale entry. Paid invoices can't be voided (credit-note instead).
export async function voidInvoice(
  db: Db, companyId: string | ObjectId, invoiceId: string | ObjectId,
  createdBy?: string | ObjectId | null,
) {
  const cid = oid(companyId);
  const inv: any = await db.collection("ar_invoices").findOne({ _id: oid(invoiceId), company_id: cid });
  if (!inv) throw new Error("Invoice not found.");
  if (inv.status === "void") return { invoice: inv, reversed: null };
  if (inv.status === "paid" || (inv.amount_paid || 0) > 0) throw new Error("A paid invoice can't be voided — issue a credit note.");

  let reversed: any = null;
  if (inv.status === "issued" && inv.gl_entry_id) {
    reversed = await reverseJournalEntry(db, cid, inv.gl_entry_id, { created_by: createdBy ?? null });
  }
  await db.collection("ar_invoices").updateOne(
    { _id: inv._id },
    { $set: { status: "void", voided_at: new Date(), void_entry_id: reversed?._id || null } },
  );
  return { invoice: { ...inv, status: "void" }, reversed };
}

// AR aging as of a date: outstanding balances bucketed by how overdue they are.
export async function arAging(db: Db, companyId: string | ObjectId, asOf?: string) {
  const cid = oid(companyId);
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const invoices = await db.collection("ar_invoices")
    .find({ company_id: cid, status: "issued" }).toArray();

  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const rows: any[] = [];
  for (const inv of invoices as any[]) {
    const outstanding = round2(inv.total - (inv.amount_paid || 0));
    if (outstanding <= 0) continue;
    const due = inv.due_date ? new Date(inv.due_date) : new Date(inv.date);
    const overdueDays = Math.floor((asOfDate.getTime() - due.getTime()) / 86_400_000);
    let bucket: keyof typeof buckets;
    if (overdueDays <= 0) bucket = "current";
    else if (overdueDays <= 30) bucket = "d1_30";
    else if (overdueDays <= 60) bucket = "d31_60";
    else if (overdueDays <= 90) bucket = "d61_90";
    else bucket = "d90_plus";
    buckets[bucket] = round2(buckets[bucket] + outstanding);
    rows.push({
      invoice_ref: inv.invoice_ref, customer_name: inv.customer_name,
      date: inv.date, due_date: inv.due_date, outstanding, overdueDays, bucket,
    });
  }
  const total = round2(Object.values(buckets).reduce((s, v) => s + v, 0));
  return { asOf: asOfDate.toISOString().slice(0, 10), buckets, total, rows };
}
