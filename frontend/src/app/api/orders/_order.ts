// Order math + HTML rendering shared by submit / summary / email.
// All totals are recomputed here from the authoritative catalog.

import { CatalogItem } from "../../orders/_catalog";

export type OrderLine = {
  id: string;
  supplier: string;
  po: string;
  category: string;
  sku: string;
  description: string;
  uom: string;
  price: number;
  qty: number;
  lineTotal: number;
};

export function money(n: number): string {
  return "$" + (Math.round(n * 100) / 100).toFixed(2);
}

// Resolve client-sent {id, sku, qty} pairs against the active catalog. Resolves
// by id, falling back to sku if the id is stale (e.g. catalog re-uploaded while a
// page was open). Unknown items and non-positive quantities are dropped.
export function buildLines(
  items: Array<{ id?: unknown; sku?: unknown; qty?: unknown }>,
  byId: Map<string, CatalogItem>,
  bySku?: Map<string, CatalogItem>
): { lines: OrderLine[]; total: number } {
  const lines: OrderLine[] = [];
  for (const it of Array.isArray(items) ? items : []) {
    const id = String(it?.id ?? "");
    const sku = String(it?.sku ?? "");
    const qty = Math.floor(Number(it?.qty));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    let c: CatalogItem | undefined = id ? byId.get(id) : undefined;
    if ((!c || (sku && c.sku !== sku)) && sku && bySku) c = bySku.get(sku) || c;
    if (!c) continue;
    const lineTotal = Math.round(c.price * qty * 100) / 100;
    lines.push({
      id: c.id,
      supplier: c.supplier,
      po: c.po,
      category: c.category,
      sku: c.sku,
      description: c.description,
      uom: c.uom,
      price: c.price,
      qty,
      lineTotal,
    });
  }
  const total = Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
  return { lines, total };
}

// Group lines by supplier (preserving catalog order) for rendering.
export function groupBySupplier(
  lines: OrderLine[]
): Array<{ supplier: string; po: string; lines: OrderLine[]; subtotal: number }> {
  const order: string[] = [];
  const map = new Map<string, OrderLine[]>();
  for (const l of lines) {
    if (!map.has(l.supplier)) {
      map.set(l.supplier, []);
      order.push(l.supplier);
    }
    map.get(l.supplier)!.push(l);
  }
  return order.map((supplier) => {
    const ls = map.get(supplier)!;
    return {
      supplier,
      po: ls[0]?.po || "",
      lines: ls,
      subtotal: Math.round(ls.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100,
    };
  });
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// HTML table of an order's lines, grouped by supplier with subtotals + grand total.
export function renderOrderHtml(lines: OrderLine[], total: number): string {
  const groups = groupBySupplier(lines);
  const blocks = groups
    .map((g) => {
      const rows = g.lines
        .map(
          (l) => `
        <tr>
          <td style="padding:4px 8px;text-align:center;font-weight:600">${l.qty}</td>
          <td style="padding:4px 8px;font-family:monospace;font-size:12px">${esc(l.sku)}</td>
          <td style="padding:4px 8px">${esc(l.description)}</td>
          <td style="padding:4px 8px;white-space:nowrap">${esc(l.uom)}</td>
          <td style="padding:4px 8px;text-align:right;white-space:nowrap">${money(l.price)}</td>
          <td style="padding:4px 8px;text-align:right;white-space:nowrap;font-weight:600">${money(l.lineTotal)}</td>
        </tr>`
        )
        .join("");
      return `
      <h3 style="margin:18px 0 6px;font-size:15px">${esc(g.supplier)} <span style="color:#666;font-weight:400">— Blanket PO ${esc(g.po)}</span></h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #e2e2e2">
        <thead>
          <tr style="background:#f3f4f6;text-align:left">
            <th style="padding:6px 8px;text-align:center">Qty</th>
            <th style="padding:6px 8px">SKU</th>
            <th style="padding:6px 8px">Description</th>
            <th style="padding:6px 8px">Unit</th>
            <th style="padding:6px 8px;text-align:right">Price</th>
            <th style="padding:6px 8px;text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="5" style="padding:6px 8px;text-align:right;font-weight:600;border-top:2px solid #ccc">${esc(g.supplier)} subtotal</td>
            <td style="padding:6px 8px;text-align:right;font-weight:700;border-top:2px solid #ccc">${money(g.subtotal)}</td>
          </tr>
        </tfoot>
      </table>`;
    })
    .join("");

  return `
  ${blocks}
  <p style="margin:18px 0 0;font-size:17px;text-align:right"><strong>Grand total: ${money(total)}</strong></p>`;
}
