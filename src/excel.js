// Excel export/import in the layout of the Basic Tracker template.
// Exported workbooks keep live formulas so they still work as a tracker in Excel.
const ExcelJS = require('exceljs');
const Calc = require('./calc');

const MONEY = '"$"#,##0.00';
const ACCT = '_-"$"* #,##0.00_-;\\-"$"* #,##0.00_-;_-"$"* "-"??_-;_-@_-';
const SHEETS = {
  quotes: 'Approved Quotes',
  labour: 'Labour',
  equipment: 'Equipment',
  materials: 'Material and Supplier Invoices',
  breakdown: 'Total Breakdown',
};

function bold(cell) { cell.font = { bold: true }; }
function q(name) { return `'${name}'`; }
function amount(v) { return Calc.round2(Calc.num(v)); }

function header(ws, rowNum, labels) {
  const row = ws.getRow(rowNum);
  labels.forEach((l, i) => { row.getCell(i + 1).value = l; bold(row.getCell(i + 1)); });
  row.eachCell(c => { c.border = { bottom: { style: 'thin' } }; });
}

// Returns the row number holding the section total.
function writeQuoteSection(ws, startRow, title, rows) {
  header(ws, startRow, [title, 'Total', 'Notes']);
  let r = startRow + 1;
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

async function exportWorkbook(job, filePath) {
  job = Calc.normalizeJob(job);
  const t = Calc.totals(job);
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

  // --- Labour / Equipment ---
  const labourRef = writeDatedSheet(wb, SHEETS.labour, job.labour);
  const equipRef = writeDatedSheet(wb, SHEETS.equipment, job.equipment);

  // --- Material and Supplier Invoices ---
  const wsM = wb.addWorksheet(SHEETS.materials);
  wsM.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 45 }, { width: 28 }, { width: 16 }];
  wsM.mergeCells('A1:C1');
  wsM.getCell('A1').value = 'Material and Supplier Invoices'; wsM.getCell('A1').font = { bold: true, size: 14 };
  wsM.getCell('A2').value = job.jobName || ''; bold(wsM.getCell('A2'));
  header(wsM, 3, ['Name', 'Invoice Number', 'Amount', 'Notes', 'Company Totals', 'Total']);
  let r = 4;
  for (const m of job.materials) {
    wsM.getCell(r, 1).value = m.supplier || '';
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
  // Company totals (SUMIF instead of GROUPBY so it works in every Excel version).
  const suppliers = Calc.supplierTotals(job.materials);
  let s = 4;
  for (const sup of suppliers) {
    wsM.getCell(s, 5).value = sup.supplier;
    wsM.getCell(s, 6).value = { formula: `SUMIF($A$4:$A$${mLast},E${s},$C$4:$C$${mLast})`, result: sup.total };
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
  wsT.getCell('D6').numFmt = '0.0%';
  line(7, `Overhead (${Calc.num(job.overheadPercent)}%)`, 'B6*$D$6', t.overhead);
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
  line(tr, 'Change Orders', `${q(SHEETS.quotes)}!B${coTotalRow}`, t.changeOrders); tr++;
  const tcvRow = tr;
  line(tr, 'Total Contract Value', `B${tr - 2}+B${tr - 1}`, t.totalContract, true); tr += 2;
  line(tr, 'Profit', `B${tcvRow}-B9`, t.profit, true);
  wsT.getCell(tr + 1, 1).value = 'Margin'; bold(wsT.getCell(tr + 1, 1));
  wsT.getCell(tr + 1, 2).value = { formula: `IF(B${tcvRow}=0,0,B${tr}/B${tcvRow})`, result: t.margin / 100 };
  wsT.getCell(tr + 1, 2).numFmt = '0.0%';

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
  await wb.xlsx.readFile(filePath);
  const job = Calc.newJob();
  const get = name => wb.worksheets.find(w => w.name.trim().toLowerCase() === name.toLowerCase());

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
    for (let r = 1; r <= wsT.rowCount; r++) {
      const m = /overhead\s*\((\d+(?:\.\d+)?)%\)/i.exec(text(wsT.getRow(r).getCell(1)));
      if (m) { job.overheadPercent = parseFloat(m[1]); break; }
    }
  }
  return job;
}

module.exports = { exportWorkbook, importWorkbook, SHEETS };
