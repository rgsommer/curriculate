// PDF payslip generator using pdfkit (pure JS, no Chrome dependency).
// Produces a single-page payslip per employee for storage and email attach.
const PDFDocument = require('pdfkit');

function fmt(n) { return (Number(n) || 0).toFixed(2); }

// Returns a Promise<Buffer> with the full PDF bytes.
function buildPayStubPdf({ company, period, employee, hours, cash_advance, note, gross, tax, nasfund, other_deductions, net, breakdown }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ccy = (company && company.currency) || 'PGK';

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text((company && company.name) || 'PNGPay', { align: 'left' });
    doc.fontSize(11).font('Helvetica').fillColor('#666')
      .text(`Pay stub · period ${period.period_start} to ${period.period_end} · paid ${period.pay_date}`);
    doc.moveDown().fillColor('#000');

    // Employee
    doc.fontSize(13).font('Helvetica-Bold')
      .text(`${employee.first_name} ${employee.last_name}`);
    doc.fontSize(10).font('Helvetica').fillColor('#444');
    const accts = (employee.bank_accounts && employee.bank_accounts.length)
      ? employee.bank_accounts
      : [{ account_name: employee.bank_account_name, account_no: employee.bank_account_no, percentage: 100 }];
    accts.filter(a => a.account_no).forEach(a => {
      doc.text(`Account: ${a.account_name || ''} ${a.account_no ? '· ' + a.account_no : ''}` +
               (accts.length > 1 ? ` · ${a.percentage}%` : ''));
    });
    doc.fillColor('#000').moveDown(0.8);

    // Lines
    const rows = [
      ['Hours worked',     fmt(hours)],
      ['Base + overtime',  ccy + ' ' + fmt(((breakdown && breakdown.base) || 0) + ((breakdown && breakdown.overtime) || 0))],
    ];
    if (breakdown && breakdown.allowance_lines && breakdown.allowance_lines.length) {
      breakdown.allowance_lines.forEach(l => rows.push([`  Allowance: ${l.name}`, ccy + ' ' + fmt(l.amount)]));
    }
    rows.push(['Gross', ccy + ' ' + fmt(gross)]);

    if (breakdown && breakdown.pre_tax_deductions && breakdown.pre_tax_deductions.length) {
      breakdown.pre_tax_deductions.forEach(l => rows.push([`  Pre-tax: ${l.name}`, '- ' + ccy + ' ' + fmt(l.amount)]));
    }
    rows.push(['Salary/wages tax',  '- ' + ccy + ' ' + fmt(tax)]);
    rows.push(['Nasfund (employee)', '- ' + ccy + ' ' + fmt(nasfund)]);
    if (breakdown && breakdown.post_tax_deductions && breakdown.post_tax_deductions.length) {
      breakdown.post_tax_deductions.forEach(l => rows.push([`  Post-tax: ${l.name}`, '- ' + ccy + ' ' + fmt(l.amount)]));
    }
    if (cash_advance > 0) rows.push(['Cash advance', '- ' + ccy + ' ' + fmt(cash_advance)]);
    rows.push(['__BOLD__ Net pay', ccy + ' ' + fmt(net)]);

    // Render rows as a two-column table
    const leftX = 56, rightX = 540;
    let y = doc.y;
    rows.forEach(([label, val]) => {
      const isTotal = label.startsWith('__BOLD__');
      if (isTotal) { label = label.replace('__BOLD__ ', '').trim(); doc.font('Helvetica-Bold'); doc.fillColor('#000'); }
      else { doc.font('Helvetica'); doc.fillColor(label.startsWith('  ') ? '#555' : '#000'); }
      doc.fontSize(11);
      doc.text(label, leftX, y, { width: 340, continued: false });
      doc.text(val,  leftX, y, { width: rightX - leftX - 8, align: 'right' });
      y = doc.y + 4;
      doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#eee').lineWidth(0.5).stroke();
      y += 4;
      doc.y = y;
    });

    if (note) {
      doc.moveDown(0.8).fillColor('#000').fontSize(10).font('Helvetica-Bold').text('Note from manager:');
      doc.font('Helvetica').fillColor('#444').text(note, { width: 480 });
    }
    if (company && company.payslip_message) {
      doc.moveDown(0.8).fillColor('#444').fontSize(10).font('Helvetica').text(company.payslip_message, { width: 480 });
    }

    // Employer / NCSL info footer
    if (breakdown && breakdown.nasfund_employer != null) {
      doc.moveDown(1.2).fontSize(9).fillColor('#888')
        .text(`Employer Nasfund contribution this period: ${ccy} ${fmt(breakdown.nasfund_employer)}`);
    }
    doc.fontSize(8).fillColor('#aaa')
      .text(`Generated ${new Date().toISOString().slice(0, 10)} · PNGPay`, { align: 'right' });

    doc.end();
  });
}

module.exports = { buildPayStubPdf };
