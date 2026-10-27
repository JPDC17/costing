// Excel export/import in the layout of the Basic Tracker template.
// Exported workbooks keep live formulas so they still work as a tracker in Excel.
const ExcelJS = require('exceljs');
const Calc = require('./calc');

const MONEY = '"$"#,##0.00';
const ACCT = '_-"$"* #,##0.00_-;\\-"$"* #,##0.00_-;_-"$"* "-"??_-;_-@_-';
const SHEETS = {
  quotes: 'Approved Quotes',
  draws: 'Progress Draws',
  labour: 'Labour',
  equipment: 'Equipment',
  materials: 'Material and Supplier Invoices',
  breakdown: 'Total Breakdown',
};

function bold(cell) { cell.font = { bold: true }; }
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
  ws.columns = [{ width: 27 }, { width: 18 }, { width: 40 }];
  header(ws, 1, ['Date(s)', 'Amount', 'Description']);
  let r = 2;
  if (!rows.length) r++;
  for (const x of rows) {
    ws.getCell(r, 1).value = x.date || '';
    ws.getCell(r, 2).value = amount(x.amount);
    ws.getCell(r, 2).numFmt = MONEY;
    ws.getCell(r, 3).value = x.description || '';
    r++;
  }
  const last = Math.max(r - 1, 2);
  ws.getCell(r, 1).value = 'Total'; bold(ws.getCell(r, 1));
  ws.getCell(r, 2).value = { formula: `SUM(B2:B${last})`, result: Calc.sum(rows) };
  ws.getCell(r, 2).numFmt = MONEY; bold(ws.getCell(r, 2));
  return `${q(name)}!B${r}`;
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
function finishSheet(ws, headerRow, landscape = false) {
  autoFit(ws);
  ws.pageSetup = { orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
  ws.headerFooter = { oddFooter: '&L&8&A&R&8Page &P of &N' };
  if (headerRow) ws.views = [{ state: 'frozen', ySplit: headerRow }];
}

async function exportWorkbook(job, filePath) {
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

  // --- Progress Draws ---
  const wsD = wb.addWorksheet(SHEETS.draws);
  wsD.columns = [{ width: 10 }, { width: 18 }, { width: 40 }, { width: 18 }, { width: 40 }];
  header(wsD, 1, ['Draw #', 'Date Submitted', 'Description', 'Amount', 'Notes']);
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
    wsD.getCell(d, 5).value = x.notes || '';
    d++;
  }
  wsD.getCell(d, 1).value = 'Total'; bold(wsD.getCell(d, 1));
  wsD.getCell(d, 4).value = { formula: `SUM(D2:D${d - 1})`, result: t.draws };
  wsD.getCell(d, 4).numFmt = MONEY; bold(wsD.getCell(d, 4));
  const drawsRef = `${q(SHEETS.draws)}!D${d}`;

  // --- Labour / Equipment ---
  const labourRef = writeDatedSheet(wb, SHEETS.labour, job.labour);
  const equipRef = writeDatedSheet(wb, SHEETS.equipment, job.equipment);

  // --- Material and Supplier Invoices ---
  const wsM = wb.addWorksheet(SHEETS.materials);
  wsM.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 45 }, { width: 28 }, { width: 16 }];
  wsM.mergeCells('A1:C1');
  wsM.getCell('A1').value = 'Material and Supplier Invoices'; wsM.getCell('A1').font = { bold: true, size: 14 };
  wsM.mergeCells('A2:D2');
  wsM.getCell('A2').value = job.jobName || ''; bold(wsM.getCell('A2'));
  header(wsM, 3, ['Name', 'Invoice Number', 'Amount', 'Notes', 'Company Totals', 'Total']);
  let r = 4;
  if (!job.materials.length) r++;
  for (const m of job.materials) {
    wsM.getCell(r, 1).value = String(m.supplier || '').trim();
    wsM.getCell(r, 2).value = m.invoiceNumber || '';
    wsM.getCell(r, 3).value = amount(m.amount); wsM.getCell(r, 3).numFmt = MONEY;
    wsM.getCell(r, 4).value = m.notes || '';
    r++;
  }
  const mLast = Math.max(r - 1, 4);
  wsM.getCell(r, 1).value = 'Total'; bold(wsM.getCell(r, 1));
  wsM.getCell(r, 3).value = { formula: `SUM(C4:C${mLast})`, result: t.materials };
  wsM.getCell(r, 3).numFmt = MONEY; bold(wsM.getCell(r, 3));
  const materialsRef = `${q(SHEETS.materials)}!C${r}`;
  // Company totals. SUMPRODUCT instead of GROUPBY so it works in every Excel version,
  // and instead of SUMIF so names containing * ? < > = are matched literally.
  const suppliers = Calc.supplierTotals(job.materials);
  const names = `$A$4:$A$${mLast}`, amounts = `$C$4:$C$${mLast}`;
  let s = 4;
  for (const sup of suppliers) {
    wsM.getCell(s, 5).value = sup.supplier;
    const match = sup.blank ? `${names}=""` : `${names}=E${s}`;
    wsM.getCell(s, 6).value = { formula: `SUMPRODUCT((${match})*${amounts})`, result: sup.total };
    wsM.getCell(s, 6).numFmt = MONEY;
    s++;
  }
  wsM.getCell(s, 5).value = 'Total'; bold(wsM.getCell(s, 5));
  wsM.getCell(s, 6).value = { formula: s > 4 ? `SUM(F4:F${s - 1})` : '0', result: t.materials };
  wsM.getCell(s, 6).numFmt = MONEY; bold(wsM.getCell(s, 6));

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
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
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

  line(tr, 'Change Orders (not included)', `${q(SHEETS.quotes)}!B${coTotalRow}`, t.changeOrders);

  finishSheet(wsQ, 2);
  finishSheet(wsD, 1, true);
  finishSheet(wb.getWorksheet(SHEETS.labour), 1);
  finishSheet(wb.getWorksheet(SHEETS.equipment), 1);
  finishSheet(wsM, 3, true);
  finishSheet(wsT, 0);

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

// Read rows below a header until a "Total" row or the next section header.
function readRows(ws, firstRow, map, stopWords = []) {
  const out = [];
  for (let r = firstRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const first = text(row.getCell(1));
    if (isTotal(row.getCell(1)) || stopWords.some(w => first.toLowerCase() === w.toLowerCase())) break;
    const item = {};
    let any = false;
    for (const [key, col, kind] of map) {
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
  const wsD = get(SHEETS.draws);
  if (wsD) {
    job.draws = readRows(wsD, 2, [['drawNumber', 1], ['date', 2], ['description', 3], ['amount', 4, 'money'], ['notes', 5]]);
  }
  for (const [key, name] of [['labour', SHEETS.labour], ['equipment', SHEETS.equipment]]) {
    const ws = get(name);
    if (ws) job[key] = readRows(ws, 2, [['date', 1], ['amount', 2, 'money'], ['description', 3]]);
  }
  const wsM = get(SHEETS.materials);
  if (wsM) {
    const hdr = findRow(wsM, 'Name');
    job.materials = readRows(wsM, hdr > 0 ? hdr + 1 : 4,
      [['supplier', 1], ['invoiceNumber', 2], ['amount', 3, 'money'], ['notes', 4]]);
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
