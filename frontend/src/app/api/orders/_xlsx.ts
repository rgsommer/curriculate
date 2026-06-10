// Builds one .xlsx workbook per supplier for a submitted order, used as finance
// email attachments. Each sheet lists that supplier's lines (qty, sku, desc, unit,
// price, line total) with a subtotal, ready to place against the blanket PO.

import * as XLSX from "xlsx";
import { OrderLine, groupBySupplier, money } from "./_order";

export type Attachment = { filename: string; content: Buffer };

function slug(s: string): string {
  return String(s).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "order";
}

export function buildSupplierWorkbooks(
  lines: OrderLine[],
  meta: { teacherName: string; schoolName: string; dateStr: string }
): Attachment[] {
  const groups = groupBySupplier(lines);
  return groups.map((g) => {
    const aoa: (string | number)[][] = [
      [`${meta.schoolName} — Supply Order`],
      ["Supplier", g.supplier],
      ["Blanket PO", g.po],
      ["Teacher", meta.teacherName],
      ["Date", meta.dateStr],
      [],
      ["Qty", "SKU", "Description", "Unit", "Unit Price", "Line Total"],
      ...g.lines.map((l) => [l.qty, l.sku, l.description, l.uom, l.price, l.lineTotal]),
      [],
      ["", "", "", "", "Subtotal", g.subtotal],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 6 }, { wch: 16 }, { wch: 52 }, { wch: 12 }, { wch: 11 }, { wch: 11 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, g.supplier.slice(0, 28));
    const content = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return {
      filename: `${slug(g.supplier)}_${slug(g.po)}_${slug(meta.teacherName)}.xlsx`,
      content,
    };
  });
}

// Re-export for callers that want the money formatter alongside.
export { money };
