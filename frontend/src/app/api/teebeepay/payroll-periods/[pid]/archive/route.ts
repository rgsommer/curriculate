// GET → ZIP archive containing all files for one pay period.
//   • BSP batch CSV
//   • QuickBooks IIF
//   • NASFund return XLSX
//   • One PDF per employee (their pay stub)
import { NextResponse } from "next/server";
import JSZip from "jszip";
import { readAuth, db, ObjectId } from "../../../_auth";
import { buildBspBatch } from "../../../_bsp";
import { buildIif } from "../../../_iif";
import { buildNasfundXlsx } from "../../../_nasfund";
import { buildPayStubPdf } from "../../../_paystub_pdf";

export const dynamic = "force-dynamic";

function safe(s: any): string {
  return String(s ?? "").replace(/[^A-Za-z0-9_\- ]+/g, "_").trim().replace(/\s+/g, "_");
}

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pid } = await params;
  try {
    const dbi = await db();
    const p: any = await dbi.collection("pay_periods").findOne({ _id: new ObjectId(pid) });
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (u.clearance < 3 && u.company_id !== p.company_id.toString()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const co: any = await dbi.collection("companies").findOne({ _id: p.company_id });
    const entries: any[] = await dbi.collection("payroll_entries").find({ pay_period_id: p._id }).toArray();
    const emps: any[] = await dbi.collection("employees").find({ _id: { $in: entries.map((e) => e.employee_id) } }).toArray();
    const empMap = Object.fromEntries(emps.map((e) => [e._id.toString(), e]));

    // Decorate employees with department/job names for the PDF
    const deptIds = [...new Set(emps.filter((e) => e.department_id).map((e) => e.department_id.toString()))];
    const jobIds  = [...new Set(emps.filter((e) => e.job_function_id).map((e) => e.job_function_id.toString()))];
    const depts = deptIds.length ? await dbi.collection("departments").find({ _id: { $in: deptIds.map((s: any) => new ObjectId(s)) } }).toArray() : [];
    const jobs  = jobIds.length  ? await dbi.collection("job_functions").find({ _id: { $in: jobIds.map((s: any) => new ObjectId(s)) } }).toArray() : [];
    const dMap = Object.fromEntries(depts.map((d: any) => [d._id.toString(), d.name]));
    const jMap = Object.fromEntries(jobs.map((j: any) => [j._id.toString(), j.name]));

    const zip = new JSZip();
    const abbr = safe(co.abbreviation || co.name || "company");
    const payDate = (p.pay_date || p.period_end || "").replace(/-/g, "");

    // 1) BSP batch CSV
    const bspRows = entries.map((e) => ({
      employee: empMap[e.employee_id.toString()] || {},
      entry: { net: Number(e.net) || 0 },
    }));
    zip.file(`BSPPayroll-${abbr}-${payDate}.csv`,
      buildBspBatch(co, p, bspRows, p.service_fees || []));

    // 2) QuickBooks IIF
    zip.file(`Payroll-${abbr}-${payDate}_QB_IIF.iif`, buildIif(co, p, entries));

    // 3) NASFund XLSX
    const nasRows = entries.map((e: any) => ({
      employee: empMap[e.employee_id.toString()] || {},
      gross: e.gross || 0, nasfund: e.nasfund || 0,
      nasfund_employer: e.calc_breakdown?.nasfund_employer ?? (e.gross || 0) * 0.084,
    }));
    const periodLabel = `${(p.period_start || "").replaceAll("-", "")}-${(p.period_end || "").replaceAll("-", "")}`;
    const nasBuf = await buildNasfundXlsx(co, periodLabel, nasRows);
    zip.file(`NASFund-${abbr}-${(p.period_end || p.pay_date || "").replace(/-/g, "")}.xlsx`, nasBuf);

    // 4) One PDF per employee
    const pdfFolder = zip.folder(`PaySlips-${payDate}`)!;
    for (const e of entries) {
      const empBase = empMap[e.employee_id.toString()];
      if (!empBase) continue;
      const emp = {
        ...empBase,
        department: empBase.department_id ? dMap[empBase.department_id.toString()] : null,
        job_function: empBase.job_function_id ? jMap[empBase.job_function_id.toString()] : null,
      };
      try {
        const pdfBuf = await buildPayStubPdf(co, p, emp, e);
        const fname = `${safe(emp.last_name || "")}-${safe(emp.first_name || "")}-${payDate}.pdf`;
        pdfFolder.file(fname, pdfBuf);
      } catch (err) {
        console.warn("[archive] payslip pdf failed for", emp.last_name, err);
      }
    }

    // README
    zip.file("README.txt",
      `TeebeePay period archive\n` +
      `------------------------\n` +
      `Company: ${co.name}\n` +
      `Pay period: ${p.period_start} to ${p.period_end}\n` +
      `Pay date: ${p.pay_date}\n` +
      `Entries: ${entries.length}\n\n` +
      `Files in this archive:\n` +
      `  • BSPPayroll-*.csv         — Bank batch file for BSP Batch Manager\n` +
      `  • Payroll-*_QB_IIF.iif     — QuickBooks journal-entry import\n` +
      `  • NASFund-*.xlsx           — Monthly NASFund contribution return\n` +
      `  • PaySlips-${payDate}/    — One PDF per employee, branded\n\n` +
      `Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")} by TeebeePay.\n`
    );

    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const filename = `TeebeePay-${abbr}-${payDate}.zip`;
    return new NextResponse(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e: any) {
    console.error("[teebeepay/archive] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
