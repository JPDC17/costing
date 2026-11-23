// Excel export/import in the layout of the Basic Tracker template.
// Exported workbooks keep live formulas so they still work as a tracker in Excel.
const ExcelJS = require('exceljs');
const Calc = require('./calc');
const Company = require('./company');

const MONEY = '"$"#,##0.00';
const ACCT = '_-"$"* #,##0.00_-;\\-"$"* #,##0.00_-;_-"$"* "-"??_-;_-@_-';
const SHEETS = {
  quotes: 'Approved Quotes',
  estimates: 'Estimates',
  draws: 'Progress Draws',
  labour: 'Labour',
  equipment: 'Equipment',
  materials: 'Material and Supplier Invoices',
  breakdown: 'Total Breakdown',
};

function bold(cell) { cell.font = { bold: true }; }

// The Estimate Item column: the estimate line's name (e.g. "Crew Cost"), with a
// dropdown of the lines in Excel.
const ITEM_HEADING = 'Estimate Item';
const itemLabel = row => { const k = Calc.estItemOf(row); return k ? Calc.ESTIMATE_LINES.find(l => l.key === k).label : ''; };
function itemDropdown(ws, col, first, last) {
  const list = `"${Calc.ESTIMATE_LINES.map(l => l.label).join(',')}"`;
  for (let r = first; r <= last; r++) {
    ws.getCell(r, col).dataValidation = { type: 'list', allowBlank: true, formulae: [list], showErrorMessage: true, errorTitle: 'Estimate item', error: 'Pick one of the estimate items, or leave it blank.' };
  }
}
// Sum of `amounts` on rows whose Estimate Item says `label` (any case, spaces ignored).
function itemSum(itemRange, amountRange, label) {
  return `SUMPRODUCT((TRIM(${itemRange}&"")="${label}")*${amountRange})`;
}

// Sum of `amounts` on rows whose Paid cell says Yes / Y / Paid / x / ✓ (any case,
// spaces ignored): the same entries the app accepts as paid (Calc.PAID_WORDS).
function paidSum(paidRange, amountRange) {
  const words = Calc.PAID_WORDS.map(w => `"${w}"`).join(',');
  return `SUMPRODUCT(ISNUMBER(MATCH(TRIM(${paidRange}&""),{${words}},0))*${amountRange})`;
}
function q(name) { return `'${name}'`; }
const amount = Calc.money;

function header(ws, rowNum, labels) {
  const row = ws.getRow(rowNum);
  labels.forEach((l, i) => { row.getCell(i + 1).value = l; bold(row.getCell(i + 1)); });
  row.eachCell(c => { c.border = { bottom: { style: 'thin' } }; });
}

// Returns the row number holding the section total.
function writeQuoteSection(ws, startRow, title, rows) {
  header(ws, startRow, [title, 'Total', 'Notes']);
  let r = startRow + 1;
  if (!rows.length) r++; // keep one empty row so the SUM never includes its own cell
  for (const x of rows) {
    ws.getCell(r, 1).value = x.description || '';
    ws.getCell(r, 2).value = amount(x.amount);
    ws.getCell(r, 2).numFmt = MONEY;
    ws.getCell(r, 3).value = x.notes || '';
    r++;
  }
  const first = startRow + 1;
  const last = Math.max(r - 1, first);
  ws.getCell(r, 1).value = 'Total'; bold(ws.getCell(r, 1));
  ws.getCell(r, 2).value = { formula: `SUM(B${first}:B${last})`, result: Calc.sum(rows) };
  ws.getCell(r, 2).numFmt = MONEY; bold(ws.getCell(r, 2));
  return r;
}

function writeDatedSheet(wb, name, rows) {
  const ws = wb.addWorksheet(name);
  ws.columns = [{ width: 27 }, { width: 18 }, { width: 40 }, { width: 18 }];
  header(ws, 1, ['Date(s)', 'Amount', 'Description', ITEM_HEADING]);
  let r = 2;
  if (!rows.length) r++;
  for (const x of rows) {
    ws.getCell(r, 1).value = x.date || '';
    ws.getCell(r, 2).value = amount(x.amount);
    ws.getCell(r, 2).numFmt = MONEY;
    ws.getCell(r, 3).value = x.description || '';
    ws.getCell(r, 4).value = itemLabel(x);
    r++;
  }
  const last = Math.max(r - 1, 2);
  itemDropdown(ws, 4, 2, last);
  ws.getCell(r, 1).value = 'Total'; bold(ws.getCell(r, 1));
  ws.getCell(r, 2).value = { formula: `SUM(B2:B${last})`, result: Calc.sum(rows) };
  ws.getCell(r, 2).numFmt = MONEY; bold(ws.getCell(r, 2));
  return { ref: `${q(name)}!B${r}`, items: `${q(name)}!D2:D${last}`, amounts: `${q(name)}!B2:B${last}` };
}

// Widen each column to fit its longest value (within limits), so names aren't cut off.
function autoFit(ws, min = 10, max = 60) {
  ws.columns.forEach((col, i) => {
    let len = 0;
    col.eachCell({ includeEmpty: false }, cell => {
      if (cell.isMerged) return; // titles span several columns, so they don't set a width
      let v = cell.value;
      if (v && typeof v === 'object' && 'formula' in v) v = v.result;
      let text = v == null ? '' : String(v);
      if (typeof v === 'number') text = cell.numFmt && cell.numFmt.includes('%') ? '100.0%' : Calc.formatMoney(v) + '  ';
      len = Math.max(len, text.length);
    });
    col.width = Math.min(Math.max(len + 2, min), max);
  });
}

// Print each sheet one page wide, and keep the header row in view while scrolling.
// Excel header/footer text treats & as a code, so a literal & is written as &&.
const hf = s => String(s || '').replace(/&/g, '&&').replace(/[\r\n]+/g, ' ');

function finishSheet(ws, headerRow, landscape = false, printHeader = '') {
  autoFit(ws);
  ws.pageSetup = { orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
  ws.headerFooter = { oddHeader: printHeader, oddFooter: '&L&8&A&R&8Page &P of &N' };
  if (headerRow) ws.views = [{ state: 'frozen', ySplit: headerRow }];
}

async function exportWorkbook(job, filePath, company) {
  company = Company.normalizeCompany(company);
  job = Calc.normalizeJob(job);
  // Leave out rows that were added but never filled in.
  job = { ...job };
  for (const k of Calc.LIST_KEYS) {
    job[k] = job[k].filter(r => !Calc.isBlankRow(r));
  }
  const t = Calc.totals(job);
  const f = Calc.forecast(job);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Job Costing';
  wb.created = new Date();

  // --- Approved Quotes (+ Change Orders) ---
  const wsQ = wb.addWorksheet(SHEETS.quotes);
  wsQ.columns = [{ width: 32 }, { width: 16 }, { width: 40 }];
  wsQ.mergeCells('A1:C1');
  wsQ.getCell('A1').value = job.jobName || 'Job Name';
  wsQ.getCell('A1').font = { bold: true, size: 14 };
  const quotesTotalRow = writeQuoteSection(wsQ, 2, 'Approved Quotes', job.quotes);
  const coStart = quotesTotalRow + 2;
  const coTotalRow = writeQuoteSection(wsQ, coStart, 'Change Orders', job.changeOrders);

  // --- Estimates: one column per approved quote, like the estimate sheet. Cost lines
  // and overhead are inputs; the rest are formulas. A quote with no figures entered
  // shows no total/profit, and the Total column only adds up quotes that have one.
  const wsE = wb.addWorksheet(SHEETS.estimates);
  const est = Calc.estimates(job);
  const nq = job.quotes.length;
  const colL = i => wsE.getColumn(i + 1).letter; // 0 -> A
  wsE.getCell('A1').value = 'Estimated Costs'; wsE.getCell('A1').font = { bold: true, size: 14 };
  const E = { head: 2, line0: 3, total: 3 + Calc.ESTIMATE_LINES.length };
  E.overhead = E.total + 1; E.bid = E.total + 2; E.profit = E.total + 3; E.margin = E.total + 4;
  const labels = [...Calc.ESTIMATE_LINES.map(l => l.label), 'Total Cost', 'Overhead', 'Bid Price', 'Profit', 'Margin'];
  labels.forEach((l, i) => { const c = wsE.getCell(E.line0 + i, 1); c.value = l; bold(c); });
  const totalCol = nq + 2; // B.. for quotes, then Total
  const tc = colL(totalCol - 1);
  const inputFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFECCC' } };
  job.quotes.forEach((x, i) => {
    const col = i + 2, L = colL(col - 1), src = 3 + i; // quote row on Approved Quotes
    const e = est.quotes[i];
    const head = wsE.getCell(E.head, col);
    head.value = { formula: `""&${q(SHEETS.quotes)}!A${src}`, result: x.description || '' };
    head.font = { bold: true }; head.alignment = { wrapText: true, horizontal: 'right', vertical: 'bottom' };
    head.border = { bottom: { style: 'thin' } };
    const put = (row, key) => {
      const c = wsE.getCell(row, col);
      c.value = String(x[key] ?? '').trim() === '' ? null : Calc.money(x[key]);
      c.numFmt = MONEY; c.fill = inputFill;
    };
    Calc.ESTIMATE_LINES.forEach((l, li) => put(E.line0 + li, l.key));
    put(E.overhead, 'estOverhead');
    const inputs = `${L}${E.line0}:${L}${E.total - 1},${L}${E.overhead}`;
    const on = `COUNT(${inputs})>0`;
    const cell = (row, formula, result, fmt = MONEY) => {
      const c = wsE.getCell(row, col);
      c.value = { formula, result }; c.numFmt = fmt;
      return c;
    };
    cell(E.total, `IF(${on},SUM(${L}${E.line0}:${L}${E.total - 1}),"")`, e.estimated ? e.totalCost : '');
    bold(wsE.getCell(E.total, col));
    cell(E.bid, `${q(SHEETS.quotes)}!B${src}`, e.bid);
    bold(cell(E.profit, `IF(${on},${L}${E.bid}-${L}${E.total}-N(${L}${E.overhead}),"")`, e.estimated ? e.profit : ''));
    cell(E.margin, `IF(AND(${on},N(${L}${E.bid})<>0),${L}${E.profit}/${L}${E.bid},"")`, e.estimated && e.bid ? e.margin / 100 : '', '0.0%');
  });
  // Total column: sums of the quotes that have an estimate.
  const hc = wsE.getCell(E.head, totalCol);
  hc.value = 'Total'; bold(hc); hc.alignment = { horizontal: 'right', vertical: 'bottom' }; hc.border = { bottom: { style: 'thin' } };
  if (nq) {
    const first = colL(1), last = colL(nq);
    const along = row => `${first}${row}:${last}${row}`;
    const has = `(${along(E.total)}<>"")`;
    const tot = (row, formula, result, fmt = MONEY) => {
      const c = wsE.getCell(row, totalCol);
      c.value = { formula, result }; c.numFmt = fmt; bold(c);
    };
    Calc.ESTIMATE_LINES.forEach((l, li) => tot(E.line0 + li, `SUM(${along(E.line0 + li)})`, est.total[l.key]));
    tot(E.total, `SUM(${along(E.total)})`, est.total.totalCost);
    tot(E.overhead, `SUM(${along(E.overhead)})`, est.total.overhead);
    tot(E.bid, `SUMPRODUCT(${has}*${along(E.bid)})`, est.total.bid);
    tot(E.profit, `SUM(${along(E.profit)})`, est.total.profit);
    tot(E.margin, `IF(${tc}${E.bid}=0,"",${tc}${E.profit}/${tc}${E.bid})`, est.total.bid ? est.total.margin / 100 : '', '0.0%');
  }
  for (const row of [E.total]) for (let c = 1; c <= totalCol; c++) wsE.getCell(row, c).border = { top: { style: 'thin' } };
  for (const row of [E.profit]) for (let c = 1; c <= totalCol; c++) wsE.getCell(row, c).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
  wsE.getCell(E.margin + 2, 1).value = 'Shaded cells can be changed. Bid Price comes from Approved Quotes; Profit = Bid Price - Total Cost - Overhead.';
  wsE.getCell(E.margin + 2, 1).font = { italic: true, color: { argb: 'FF666666' } };
  const estProfitRef = nq ? `${q(SHEETS.estimates)}!${tc}${E.profit}` : null;

  // --- Progress Draws ---
  const wsD = wb.addWorksheet(SHEETS.draws);
  wsD.columns = [{ width: 10 }, { width: 18 }, { width: 40 }, { width: 18 }, { width: 8 }, { width: 40 }];
  header(wsD, 1, ['Draw #', 'Date Submitted', 'Description', 'Amount', 'Paid', 'Notes']);
  let d = 2;
  if (!job.draws.length) d++; // keep one empty row so the SUM never includes its own cell
  for (const x of job.draws) {
    // Plain draw numbers are written as numbers so Excel doesn't flag "number stored as text".
    const n = String(x.drawNumber ?? '').trim();
    wsD.getCell(d, 1).value = /^\d{1,9}$/.test(n) ? Number(n) : n;
    wsD.getCell(d, 1).alignment = { horizontal: 'left' };
    wsD.getCell(d, 2).value = x.date || '';
    wsD.getCell(d, 3).value = x.description || '';
    wsD.getCell(d, 4).value = amount(x.amount); wsD.getCell(d, 4).numFmt = MONEY;
    wsD.getCell(d, 5).value = Calc.isPaid(x) ? 'Yes' : '';
    wsD.getCell(d, 5).alignment = { horizontal: 'center' };
    wsD.getCell(d, 6).value = x.notes || '';
    d++;
  }
  wsD.getCell(d, 1).value = 'Total'; bold(wsD.getCell(d, 1));
  wsD.getCell(d, 4).value = { formula: `SUM(D2:D${d - 1})`, result: t.draws };
  wsD.getCell(d, 4).numFmt = MONEY; bold(wsD.getCell(d, 4));
  const drawsRef = `${q(SHEETS.draws)}!D${d}`;
  // Paid draws: Paid column says "Yes" (type Yes, Y or x in Excel to mark one paid).
  wsD.getCell(d + 1, 1).value = 'Paid'; bold(wsD.getCell(d + 1, 1));
  wsD.getCell(d + 1, 4).value = { formula: paidSum(`E2:E${d - 1}`, `D2:D${d - 1}`), result: t.drawsPaid };
  wsD.getCell(d + 1, 4).numFmt = MONEY;
  wsD.getCell(d + 2, 1).value = 'Outstanding'; bold(wsD.getCell(d + 2, 1));
  wsD.getCell(d + 2, 4).value = { formula: `D${d}-D${d + 1}`, result: t.drawsOutstanding };
  wsD.getCell(d + 2, 4).numFmt = MONEY;
  const drawsPaidRef = `${q(SHEETS.draws)}!D${d + 1}`;

  // --- Labour / Equipment ---
  const labourSheet = writeDatedSheet(wb, SHEETS.labour, job.labour);
  const equipSheet = writeDatedSheet(wb, SHEETS.equipment, job.equipment);
  const labourRef = labourSheet.ref, equipRef = equipSheet.ref;

  // --- Material and Supplier Invoices ---
  const wsM = wb.addWorksheet(SHEETS.materials);
  wsM.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 45 }, { width: 8 }, { width: 18 }, { width: 3 }, { width: 28 }, { width: 16 }];
  wsM.mergeCells('A1:C1');
  wsM.getCell('A1').value = 'Material and Supplier Invoices'; wsM.getCell('A1').font = { bold: true, size: 14 };
  wsM.mergeCells('A2:D2');
  wsM.getCell('A2').value = job.jobName || ''; bold(wsM.getCell('A2'));
  header(wsM, 3, ['Name', 'Invoice Number', 'Amount', 'Notes', 'Paid', ITEM_HEADING]);
  for (const [col, label] of [[8, 'Company Totals'], [9, 'Total']]) {
    const c = wsM.getCell(3, col); c.value = label; bold(c); c.border = { bottom: { style: 'thin' } };
  }
  let r = 4;
  if (!job.materials.length) r++;
  for (const m of job.materials) {
    wsM.getCell(r, 1).value = String(m.supplier || '').trim();
    wsM.getCell(r, 2).value = m.invoiceNumber || '';
    wsM.getCell(r, 3).value = amount(m.amount); wsM.getCell(r, 3).numFmt = MONEY;
    wsM.getCell(r, 4).value = m.notes || '';
    wsM.getCell(r, 5).value = Calc.isPaid(m) ? 'Yes' : '';
    wsM.getCell(r, 5).alignment = { horizontal: 'center' };
    wsM.getCell(r, 6).value = itemLabel(m);
    r++;
  }
  const mLast = Math.max(r - 1, 4);
  itemDropdown(wsM, 6, 4, mLast);
  wsM.getCell(r, 1).value = 'Total'; bold(wsM.getCell(r, 1));
  wsM.getCell(r, 3).value = { formula: `SUM(C4:C${mLast})`, result: t.materials };
  wsM.getCell(r, 3).numFmt = MONEY; bold(wsM.getCell(r, 3));
  const materialsRef = `${q(SHEETS.materials)}!C${r}`;
  wsM.getCell(r + 1, 1).value = 'Unpaid'; bold(wsM.getCell(r + 1, 1));
  wsM.getCell(r + 1, 3).value = { formula: `C${r}-${paidSum(`E4:E${mLast}`, `C4:C${mLast}`)}`, result: t.materialsUnpaid };
  wsM.getCell(r + 1, 3).numFmt = MONEY;
  const unpaidRef = `${q(SHEETS.materials)}!C${r + 1}`;
  // Company totals. SUMPRODUCT instead of GROUPBY so it works in every Excel version,
  // and instead of SUMIF so names containing * ? < > = are matched literally.
  const suppliers = Calc.supplierTotals(job.materials);
  const names = `$A$4:$A$${mLast}`, amounts = `$C$4:$C$${mLast}`;
  let s = 4;
  for (const sup of suppliers) {
    wsM.getCell(s, 8).value = sup.supplier;
    const match = sup.blank ? `${names}=""` : `${names}=H${s}`;
    wsM.getCell(s, 9).value = { formula: `SUMPRODUCT((${match})*${amounts})`, result: sup.total };
    wsM.getCell(s, 9).numFmt = MONEY;
    s++;
  }
  wsM.getCell(s, 8).value = 'Total'; bold(wsM.getCell(s, 8));
  wsM.getCell(s, 9).value = { formula: s > 4 ? `SUM(I4:I${s - 1})` : '0', result: t.materials };
  wsM.getCell(s, 9).numFmt = MONEY; bold(wsM.getCell(s, 9));

  // --- Estimate vs actual by item, under the Estimates table. Actual costs are the
  // Labour, Equipment and invoice rows whose Estimate Item names that line.
  if (nq) {
    const byItem = Calc.estimateByItem(job);
    let br = E.margin + 4;
    const hdr = ['Estimate vs Actual by Item', 'Estimated', 'Actual to Date', 'Left in Estimate', 'Used'];
    hdr.forEach((h, i) => { const c = wsE.getCell(br, i + 1); c.value = h; bold(c); c.border = { bottom: { style: 'thin' } }; });
    br++;
    const firstLine = br;
    const sources = [[labourSheet.items, labourSheet.amounts], [equipSheet.items, equipSheet.amounts], [`${q(SHEETS.materials)}!F4:F${mLast}`, `${q(SHEETS.materials)}!C4:C${mLast}`]];
    const put = (row, label, estFormula, estResult, actFormula, actResult, isBold) => {
      wsE.getCell(row, 1).value = label; if (isBold) bold(wsE.getCell(row, 1));
      const set = (col, formula, result, fmt = MONEY) => { const c = wsE.getCell(row, col); c.value = { formula, result }; c.numFmt = fmt; if (isBold) bold(c); };
      if (estFormula) set(2, estFormula, estResult);
      set(3, actFormula, actResult);
      if (estFormula) {
        set(4, `B${row}-C${row}`, Calc.round2(estResult - actResult));
        set(5, `IF(B${row}=0,"",C${row}/B${row})`, estResult ? actResult / estResult : '', '0.0%');
      }
    };
    byItem.lines.forEach((l, i) => {
      put(br, l.label, `${tc}${E.line0 + i}`, l.estimated, sources.map(([items, amts]) => itemSum(items, amts, l.label)).join('+'), l.actual);
      br++;
    });
    const lastLine = br - 1;
    const bd = q(SHEETS.breakdown);
    put(br, 'Not linked to an estimate item', null, 0, `${bd}!B6-SUM(C${firstLine}:C${lastLine})`, byItem.unlinked.actual); br++;
    for (let c = 1; c <= 5; c++) wsE.getCell(br, c).border = { top: { style: 'thin' } };
    put(br, 'Total before overhead', `${tc}${E.total}`, byItem.subtotal.estimated, `${bd}!B6`, byItem.subtotal.actual, true); br++;
    put(br, 'Overhead', `${tc}${E.overhead}`, byItem.overhead.estimated, `${bd}!B7`, byItem.overhead.actual); br++;
    put(br, 'Total with overhead', `B${br - 2}+B${br - 1}`, byItem.total.estimated, `${bd}!B9`, byItem.total.actual, true);
    for (let c = 1; c <= 5; c++) wsE.getCell(br, c).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    wsE.getCell(br + 2, 1).value = 'Pick each cost\'s estimate item in the Estimate Item column on the Labour, Equipment and Material and Supplier Invoices sheets.';
    wsE.getCell(br + 2, 1).font = { italic: true, color: { argb: 'FF666666' } };
  }

  // --- Total Breakdown ---
  const wsT = wb.addWorksheet(SHEETS.breakdown);
  wsT.columns = [{ width: 30 }, { width: 22 }, { width: 30 }];
  wsT.mergeCells('A1:B1');
  wsT.getCell('A1').value = 'Total Costs'; wsT.getCell('A1').font = { bold: true, size: 14 };
  const line = (row, label, formula, result, isBold) => {
    wsT.getCell(row, 1).value = label; bold(wsT.getCell(row, 1));
    wsT.getCell(row, 2).value = { formula, result };
    wsT.getCell(row, 2).numFmt = ACCT;
    if (isBold) bold(wsT.getCell(row, 2));
  };
  line(2, 'Labour', labourRef, t.labour);
  line(3, 'Equipment', equipRef, t.equipment);
  line(4, 'Material and Supplier', materialsRef, t.materials);
  wsT.getCell('C4').value = { formula: `"Unpaid: "&TEXT(${unpaidRef},"$#,##0.00")`, result: `Unpaid: ${Calc.formatMoney(t.materialsUnpaid)}` };
  wsT.getCell('C4').font = { italic: true, color: { argb: 'FF666666' } };
  line(6, 'Total', 'SUM(B2:B4)', t.subtotal, true);
  wsT.getCell('C6').value = 'Overhead %'; bold(wsT.getCell('C6'));
  wsT.getCell('D6').value = Calc.num(job.overheadPercent) / 100;
  wsT.getCell('D6').numFmt = '0.0#%'; // shows 12.0% and 7.25%
  line(7, `Overhead (${Calc.num(job.overheadPercent)}%)`, 'ROUND(B6*$D$6,2)', t.overhead);
  line(9, 'Total Costs', 'B6+B7', t.totalCosts, true);

  wsT.getCell('A11').value = 'Original Contract Value'; wsT.getCell('A11').font = { bold: true, underline: true };
  let tr = 12;
  job.quotes.forEach((x, i) => {
    const src = 3 + i;
    wsT.getCell(tr, 1).value = { formula: `""&${q(SHEETS.quotes)}!A${src}`, result: x.description || '' };
    wsT.getCell(tr, 2).value = { formula: `${q(SHEETS.quotes)}!B${src}`, result: amount(x.amount) };
    wsT.getCell(tr, 2).numFmt = ACCT;
    wsT.getCell(tr, 3).value = { formula: `""&${q(SHEETS.quotes)}!C${src}`, result: x.notes || '' };
    tr++;
  });
  line(tr, 'Original Contract Total', `${q(SHEETS.quotes)}!B${quotesTotalRow}`, t.originalContract); tr++;
  const tcvRow = tr;
  line(tr, 'Total Contract Value', `B${tr - 1}`, t.totalContract, true); tr += 2;
  const pct = (row, label, formula, result) => {
    wsT.getCell(row, 1).value = label; bold(wsT.getCell(row, 1));
    wsT.getCell(row, 2).value = { formula, result };
    wsT.getCell(row, 2).numFmt = '0.0%';
  };
  const profitRow = tr;
  line(tr, 'Contract Profit (Costs to Date)', `B${tcvRow}-B9`, t.profit, true);
  pct(tr + 1, 'Contract Margin', `IF(B${tcvRow}=0,0,B${profitRow}/B${tcvRow})`, t.margin / 100);
  tr += 3;

  wsT.getCell(tr, 1).value = 'Progress Draws'; wsT.getCell(tr, 1).font = { bold: true, underline: true }; tr++;
  const drawsRow = tr;
  line(tr, 'Draws Submitted', drawsRef, t.draws); tr++;
  line(tr, 'Paid by Client', drawsPaidRef, t.drawsPaid); tr++;
  line(tr, 'Outstanding (Not Yet Paid)', `B${drawsRow}-B${tr - 1}`, t.drawsOutstanding); tr++;
  pct(tr, 'Billed to Date (% of Contract)', `IF(B${tcvRow}=0,0,B${drawsRow}/B${tcvRow})`, t.billedPercent / 100); tr++;
  line(tr, 'Remaining to Bill', `B${tcvRow}-B${drawsRow}`, t.remainingToBill); tr++;
  const ptdRow = tr;
  line(tr, 'Profit to Date (Draws - Costs)', `B${drawsRow}-B9`, t.profitToDate, true); tr++;
  pct(tr, 'Margin on Draws', `IF(B${drawsRow}=0,0,B${ptdRow}/B${drawsRow})`, t.marginToDate / 100); tr += 2;

  // Profit forecast. The three shaded cells are inputs: change them in Excel and the
  // forecast recalculates.
  wsT.getCell(tr, 1).value = 'Profit Forecast'; wsT.getCell(tr, 1).font = { bold: true, underline: true };
  wsT.getCell(tr, 3).value = 'Shaded cells can be changed'; wsT.getCell(tr, 3).font = { italic: true, color: { argb: 'FF666666' } };
  tr++;
  const input = (row, label, value, fmt) => {
    wsT.getCell(row, 1).value = label; bold(wsT.getCell(row, 1));
    const c = wsT.getCell(row, 2);
    c.value = value === null ? null : value;
    c.numFmt = fmt;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFECCC' } }; // light orange from the app palette
    c.border = { top: { style: 'thin', color: { argb: 'FFBFBFBF' } }, bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } }, left: { style: 'thin', color: { argb: 'FFBFBFBF' } }, right: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
  };
  const dwRow = tr; input(tr++, 'Days Worked to Date', f.daysWorked || null, '0.##');
  const drRow = tr; input(tr++, 'Days Remaining', f.daysRemaining || null, '0.##');
  const mrRow = tr; input(tr++, 'Materials Still to Buy', Calc.num(job.materialsRemaining) ? f.materialsRemaining : null, ACCT);
  const dw = `B${dwRow}`, dr = `B${drRow}`;
  line(tr++, 'Labour per Day', `IF(${dw}>0,B2/${dw},0)`, f.labourPerDay);
  line(tr++, 'Equipment per Day', `IF(${dw}>0,B3/${dw},0)`, f.equipmentPerDay);
  const rlRow = tr; line(tr++, 'Remaining Labour', `IF(${dw}>0,ROUND(B2*${dr}/${dw},2),0)`, f.labourRemaining);
  const reRow = tr; line(tr++, 'Remaining Equipment', `IF(${dw}>0,ROUND(B3*${dr}/${dw},2),0)`, f.equipmentRemaining);
  const fsRow = tr; line(tr++, 'Forecast Subtotal', `B6+B${rlRow}+B${reRow}+B${mrRow}`, f.subtotal);
  const foRow = tr; line(tr++, 'Forecast Overhead', `ROUND(B${fsRow}*$D$6,2)`, f.overhead);
  const ftcRow = tr; line(tr++, 'Forecast Total Costs', `B${fsRow}+B${foRow}`, f.totalCosts, true);
  line(tr++, 'Cost to Complete', `B${ftcRow}-B9`, f.costToComplete);
  const fpRow = tr; line(tr++, 'Forecast Profit at Completion', `B${tcvRow}-B${ftcRow}`, f.profit, true);
  pct(tr++, 'Forecast Margin', `IF(B${tcvRow}=0,0,B${fpRow}/B${tcvRow})`, f.margin / 100);
  tr++;

  line(tr, 'Change Orders (not included)', `${q(SHEETS.quotes)}!B${coTotalRow}`, t.changeOrders); tr += 2;
  if (estProfitRef && est.any) { line(tr, 'Estimated Profit (from Estimates)', `N(${estProfitRef})`, est.total.profit); tr += 2; }
  line(tr, 'Unpaid Supplier Invoices', unpaidRef, t.materialsUnpaid);

  // Company name in the printed page header; logo at the top right of Total Breakdown.
  const printHeader = company.name || job.jobName ? `&L&9&B${hf(company.name)}&R&9${hf(job.jobName)}` : '';
  finishSheet(wsQ, 2, false, printHeader);
  finishSheet(wsE, E.head, true, printHeader);
  wsE.getColumn(1).width = 30;
  for (let c = 2; c <= totalCol; c++) wsE.getColumn(c).width = 16;
  wsE.getRow(E.head).height = 32;
  wsE.views = [{ state: 'frozen', xSplit: 1, ySplit: E.head }];
  finishSheet(wsD, 1, true, printHeader);
  finishSheet(wb.getWorksheet(SHEETS.labour), 1, false, printHeader);
  finishSheet(wb.getWorksheet(SHEETS.equipment), 1, false, printHeader);
  finishSheet(wsM, 3, true, printHeader);
  finishSheet(wsT, 0, false, printHeader);
  if (company.name) {
    wsT.getCell('F1').value = company.name;
    wsT.getCell('F1').font = { bold: true, size: 12 };
    wsT.getColumn(6).width = Math.max(wsT.getColumn(6).width || 10, Math.min(60, company.name.length + 4), 32);
  }
  const size = Company.imageSize(company.logo);
  if (size && size.width && size.height) {
    const id = wb.addImage({ base64: company.logo, extension: size.type });
    const h = Math.min(60, size.height), w = Math.min(220, Math.round(size.width * h / size.height));
    wsT.addImage(id, { tl: { col: 5, row: company.name ? 1.2 : 0.2 }, ext: { width: w, height: Math.round(w * size.height / size.width) }, editAs: 'oneCell' });
  }

  await wb.xlsx.writeFile(filePath);
}

// ---------- Import ----------

function cellValue(cell) {
  let v = cell ? cell.value : null;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) v = v.result;
    else if ('richText' in v) v = v.richText.map(t => t.text).join('');
    else if ('text' in v) v = v.text;
    else if ('error' in v) v = null;
  }
  return v === undefined ? null : v;
}

function text(cell) {
  const v = cellValue(cell);
  if (v === null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function isTotal(cell) { return /^total$/i.test(text(cell)); }

// Find each wanted column by its heading text, e.g. { amount: 'Amount', paid: 'Paid' }.
// Older files without a heading fall back to the column given in `defaults`.
function columns(ws, headerRow, wanted, defaults) {
  const found = {};
  ws.getRow(headerRow).eachCell((cell, col) => {
    const h = text(cell).toLowerCase();
    for (const [key, label] of Object.entries(wanted)) if (h === label.toLowerCase() && !found[key]) found[key] = col;
  });
  return Object.entries(wanted).map(([key]) => found[key] ?? defaults[key]).map((col, i) => [Object.keys(wanted)[i], col]);
}

// Read rows below a header until a "Total" row or the next section header.
// Columns that don't exist in the file (col undefined) are left empty.
function readRows(ws, firstRow, map, stopWords = []) {
  const out = [];
  for (let r = firstRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const first = text(row.getCell(1));
    if (isTotal(row.getCell(1)) || stopWords.some(w => first.toLowerCase() === w.toLowerCase())) break;
    const item = {};
    let any = false;
    for (const [key, col, kind] of map) {
      if (!col) { item[key] = kind === 'paid' ? false : ''; continue; }
      if (kind === 'paid') { item[key] = Calc.isPaid({ paid: text(row.getCell(col)) }); continue; }
      const val = kind === 'money' ? Calc.num(cellValue(row.getCell(col))) : text(row.getCell(col));
      item[key] = val;
      if (kind === 'money' ? val !== 0 : val !== '') any = true;
    }
    if (any) out.push(item);
  }
  return out;
}

function findRow(ws, label) {
  for (let r = 1; r <= ws.rowCount; r++) {
    if (text(ws.getRow(r).getCell(1)).toLowerCase() === label.toLowerCase()) return r;
  }
  return -1;
}

// Store the estimate line's key (e.g. "Crew Cost" -> estCrew); rows without one get no estItem.
function cleanItem(row) {
  const k = Calc.estItemOf(row);
  if (k) row.estItem = k; else delete row.estItem;
  return row;
}

async function importWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(filePath);
  } catch (err) {
    throw new Error('This file could not be read as an Excel workbook (.xlsx).');
  }
  const job = Calc.newJob();
  const get = name => wb.worksheets.find(w => w.name.trim().toLowerCase() === name.toLowerCase());
  if (!Object.values(SHEETS).some(get)) {
    throw new Error('This workbook doesn\'t look like the Basic Tracker template or a Job Costing export (no matching sheet names).');
  }

  const wsQ = get(SHEETS.quotes);
  if (wsQ) {
    const name = text(wsQ.getCell('A1'));
    if (name && name !== 'Job Name') job.jobName = name;
    const qRow = findRow(wsQ, 'Approved Quotes');
    const quoteMap = [['description', 1], ['amount', 2, 'money'], ['notes', 3]];
    if (qRow > 0) job.quotes = readRows(wsQ, qRow + 1, quoteMap, ['Change Orders']);
    const coRow = findRow(wsQ, 'Change Orders');
    if (coRow > 0) {
      // Skip an optional header row directly under the "Change Orders" label.
      const next = text(wsQ.getRow(coRow + 1).getCell(2)).toLowerCase();
      job.changeOrders = readRows(wsQ, next === 'total' ? coRow + 2 : coRow + 1, quoteMap);
    }
  }
  // Estimates: columns match the quotes in order; rows are found by their labels.
  const wsE = get(SHEETS.estimates);
  if (wsE && job.quotes.length) {
    const keyOf = Object.fromEntries([...Calc.ESTIMATE_LINES.map(l => [l.label.toLowerCase(), l.key]), ['overhead', 'estOverhead']]);
    const seen = new Set(); // only the estimate table at the top, not the comparison under it
    for (let r = 1; r <= wsE.rowCount; r++) {
      const key = keyOf[text(wsE.getRow(r).getCell(1)).toLowerCase()];
      if (!key || seen.has(key)) continue;
      seen.add(key);
      job.quotes.forEach((x, i) => {
        const v = cellValue(wsE.getRow(r).getCell(i + 2));
        if (v !== null && String(v).trim() !== '') x[key] = typeof v === 'number' ? Calc.round2(v) : Calc.num(v);
      });
    }
  }
  const wsD = get(SHEETS.draws);
  if (wsD) {
    const c = Object.fromEntries(columns(wsD, 1,
      { drawNumber: 'Draw #', date: 'Date Submitted', description: 'Description', amount: 'Amount', paid: 'Paid', notes: 'Notes' },
      { drawNumber: 1, date: 2, description: 3, amount: 4, notes: 5 }));
    job.draws = readRows(wsD, 2, [['drawNumber', c.drawNumber], ['date', c.date], ['description', c.description], ['amount', c.amount, 'money'], ['paid', c.paid, 'paid'], ['notes', c.notes]]);
  }
  for (const [key, name] of [['labour', SHEETS.labour], ['equipment', SHEETS.equipment]]) {
    const ws = get(name);
    if (!ws) continue;
    const c = Object.fromEntries(columns(ws, 1, { estItem: ITEM_HEADING }, {}));
    job[key] = readRows(ws, 2, [['date', 1], ['amount', 2, 'money'], ['description', 3], ['estItem', c.estItem]]).map(cleanItem);
  }
  const wsM = get(SHEETS.materials);
  if (wsM) {
    const hdr = findRow(wsM, 'Name');
    const c = hdr > 0
      ? Object.fromEntries(columns(wsM, hdr, { supplier: 'Name', invoiceNumber: 'Invoice Number', amount: 'Amount', notes: 'Notes', paid: 'Paid', estItem: ITEM_HEADING },
        { supplier: 1, invoiceNumber: 2, amount: 3, notes: 4 }))
      : { supplier: 1, invoiceNumber: 2, amount: 3, notes: 4 };
    job.materials = readRows(wsM, hdr > 0 ? hdr + 1 : 4,
      [['supplier', c.supplier], ['invoiceNumber', c.invoiceNumber], ['amount', c.amount, 'money'], ['notes', c.notes], ['paid', c.paid, 'paid'], ['estItem', c.estItem]]).map(cleanItem);
  }
  const wsT = get(SHEETS.breakdown);
  if (wsT) {
    // Prefer the editable "Overhead %" cell written by this app; fall back to the
    // template's "Overhead (12%)" label.
    let pct = null;
    for (let r = 1; r <= wsT.rowCount && pct === null; r++) {
      const row = wsT.getRow(r);
      if (/^overhead %$/i.test(text(row.getCell(3)))) {
        const v = cellValue(row.getCell(4));
        if (typeof v === 'number') pct = Calc.round2(v * 100);
      }
    }
    for (let r = 1; r <= wsT.rowCount && pct === null; r++) {
      const m = /overhead\s*\((\d+(?:\.\d+)?)%\)/i.exec(text(wsT.getRow(r).getCell(1)));
      if (m) pct = parseFloat(m[1]);
    }
    if (pct !== null) job.overheadPercent = pct;
    // Forecast inputs (blank cells mean "not entered").
    const fields = { 'days worked to date': 'daysWorked', 'days remaining': 'daysRemaining', 'materials still to buy': 'materialsRemaining' };
    for (let r = 1; r <= wsT.rowCount; r++) {
      const key = fields[text(wsT.getRow(r).getCell(1)).toLowerCase()];
      if (!key) continue;
      const v = cellValue(wsT.getRow(r).getCell(2));
      job[key] = typeof v === 'number' ? v : (Calc.num(v) || '');
    }
  }
  return job;
}

module.exports = { exportWorkbook, importWorkbook, SHEETS };
