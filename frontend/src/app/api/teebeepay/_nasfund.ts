// frontend/src/app/api/teebeepay/_nasfund.ts
//
// NASFund monthly contribution return as XLSX. Matches the column set
// observed in the historical archive's NCSL returns.
import * as XLSX from "xlsx";

export function buildNasfundXlsx(company: any, periodLabel: string, rows: any[]) {
  const header = [
    "00", "Employer Name", "Employer Number", "Date of Reg", "Bank Statement Reference",
  ];
  const employerInfo = [
    "01",
    company.name || "",
    company.ncsl_employer_no || "",
    company.ncsl_date_of_reg || "",
    `${company.bank_account_no || ""}/${periodLabel}`,
  ];
  const colHeader = [
    "02",
    "Client Number", "Payroll Number", "Surname", "Given Name(s)", "Date of birth",
    "Gross Pay", "Employee 6%", "Employer 8.4%", "Total",
    "Education Savings", "General Savings", "Christmas Savings", "Loan Repayment",
    "Status",
  ];
  const dataRows = rows.map((r, i) => {
    const emp = r.employee || {};
    const gross = Number(r.gross || 0);
    const empContrib = Number(r.nasfund || gross * 0.06);
    const emprContrib = Number(r.nasfund_employer || gross * 0.084);
    return [
      "03",
      emp.nasfund_member_no || emp.ncsl_member_no || "",  // member number
      String(i + 1),
      emp.last_name || "",
      emp.first_name || "",
      emp.dob || "",
      gross.toFixed(2),
      empContrib.toFixed(2),
      emprContrib.toFixed(2),
      (empContrib + emprContrib).toFixed(2),
      Number(emp.education_deduction || 0).toFixed(2),
      Number(emp.savings_deduction || 0).toFixed(2),
      Number(emp.christmas_bonus || 0).toFixed(2),
      Number(emp.loan_repayment || 0).toFixed(2),
      emp.is_active === 0 ? "TERMINATED" : "ACTIVE",
    ];
  });

  // Totals row
  const totals = dataRows.reduce(
    (acc, r) => {
      acc.gross += Number(r[6]); acc.emp += Number(r[7]); acc.empr += Number(r[8]);
      acc.tot += Number(r[9]);
      return acc;
    },
    { gross: 0, emp: 0, empr: 0, tot: 0 }
  );
  const totalRow = [
    "99", "", "", "TOTALS", "", "",
    totals.gross.toFixed(2), totals.emp.toFixed(2), totals.empr.toFixed(2), totals.tot.toFixed(2),
    "", "", "", "", "",
  ];

  const aoa = [header, employerInfo, [], colHeader, ...dataRows, [], totalRow];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 4 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "NASFund Contribution");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
