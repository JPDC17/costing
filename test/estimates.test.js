const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const Calc = require('../src/calc');
const { exportWorkbook, importWorkbook, SHEETS } = require('../src/excel');

const job = {
  ...Calc.newJob(),
  jobName: 'Estimate test',
  quotes: [
    { description: 'Quote 1 - Excavation', amount: 150030.8, notes: '',
      estCrew: 62000, estMaterial: '31,500.50', estSub: 0, estGrading: 12000, estStone: 8800, estTrucking: 4100, estOverhead: 14000 },
    { description: 'Quote 2 - Paving', amount: 80000, notes: '', estCrew: 30000, estMaterial: 25000, estOverhead: 6000.005 },
    { description: 'Quote 3 - No estimate yet', amount: 50000, notes: '' },
  ],
  labour: [{ amount: 50000 }],
  equipment: [{ amount: 10000 }],
  materials: [{ supplier: 'A', amount: 40000 }],
  draws: [{ drawNumber: '1', amount: 100000 }],
};

function tmp(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jobcost-')), name);
}

test('each quote: Total Cost is the six lines, Profit = Bid - Total Cost - Overhead', () => {
  const e = Calc.estimateOf(job.quotes[0]);
  assert.strictEqual(e.totalCost, 118400.5);
  assert.strictEqual(e.overhead, 14000);
  assert.strictEqual(e.bid, 150030.8);
  assert.strictEqual(e.profit, 17630.3);
  assert.strictEqual(Calc.formatPercent(e.margin), '11.8%');
  // overhead rounded to the cent like every other amount
  assert.strictEqual(Calc.estimateOf(job.quotes[1]).overhead, 6000.01);
  assert.strictEqual(Calc.estimateOf(job.quotes[1]).profit, 18999.99);
});

test('totals only include quotes with an estimate', () => {
  const e = Calc.estimates(job);
  assert.strictEqual(e.count, 2);
  assert.strictEqual(e.quoteCount, 3);
  assert.strictEqual(e.complete, false);
  assert.strictEqual(e.total.bid, 230030.8); // Quote 3 has no estimate, so its price isn't counted as profit
  assert.strictEqual(e.total.totalCost, 173400.5);
  assert.strictEqual(e.total.overhead, 20000.01);
  assert.strictEqual(e.total.profit, 36630.29);
  // compared with actual costs before overhead
  assert.strictEqual(e.actualDirect, 100000);
  assert.strictEqual(e.remaining, 73400.5);
  assert.strictEqual(Calc.formatPercent(e.usedPercent), '57.7%');
});

test('a 0 typed in counts as an estimate; blank or no fields do not', () => {
  assert.strictEqual(Calc.hasEstimate({ amount: 5, estCrew: 0 }), true);
  assert.strictEqual(Calc.hasEstimate({ amount: 5, estCrew: '0' }), true);
  assert.strictEqual(Calc.hasEstimate({ amount: 5, estCrew: '  ' }), false);
  assert.strictEqual(Calc.hasEstimate({ amount: 5 }), false);
  assert.strictEqual(Calc.estimates({ quotes: [] }).any, false);
});

test('a quote row with only estimate figures is not a blank row', () => {
  assert.strictEqual(Calc.isBlankRow({ id: 'x', description: '', amount: '', estCrew: '' }), true);
  assert.strictEqual(Calc.isBlankRow({ id: 'x', description: '', amount: '', estCrew: '1200' }), false);
});

test('Excel: Estimates sheet has inputs and live formulas matching the app', async () => {
  const file = tmp('est.xlsx');
  await exportWorkbook(job, file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(SHEETS.estimates);
  const rowOf = label => [...Array(ws.rowCount).keys()].map(i => i + 1).find(r => ws.getCell(r, 1).value === label);
  const e = Calc.estimates(job);
  assert.strictEqual(ws.getCell(2, 2).value.formula, `""&'Approved Quotes'!A3`);
  assert.strictEqual(ws.getCell(rowOf('Crew Cost'), 2).value, 62000);
  assert.strictEqual(ws.getCell(rowOf('Material'), 2).value, 31500.5);
  assert.strictEqual(ws.getCell(rowOf('Grading Labour'), 3).value, null); // left blank, stays blank
  assert.strictEqual(ws.getCell(rowOf('Bid Price'), 2).value.formula, "'Approved Quotes'!B3");
  assert.strictEqual(ws.getCell(rowOf('Total Cost'), 2).value.result, 118400.5);
  assert.strictEqual(ws.getCell(rowOf('Profit'), 2).value.result, 17630.3);
  assert.ok([undefined, ''].includes(ws.getCell(rowOf('Profit'), 4).value.result)); // no estimate: no profit
  assert.strictEqual(ws.getCell(rowOf('Profit'), 5).value.result, e.total.profit);
  assert.strictEqual(ws.getCell(rowOf('Bid Price'), 5).value.result, e.total.bid);
  assert.match(ws.getCell(rowOf('Bid Price'), 5).value.formula, /^SUMPRODUCT\(\(B\d+:D\d+<>""\)\*B\d+:D\d+\)$/);
  const tb = wb.getWorksheet(SHEETS.breakdown);
  const tRow = [...Array(tb.rowCount).keys()].map(i => i + 1).find(r => tb.getCell(r, 1).value === 'Estimated Profit (from Estimates)');
  assert.strictEqual(tb.getCell(tRow, 2).value.result, e.total.profit);
});

test('Excel: estimates round-trip through export and import', async () => {
  const file = tmp('est-round.xlsx');
  await exportWorkbook(job, file);
  const back = await importWorkbook(file);
  for (let i = 0; i < job.quotes.length; i++) {
    for (const k of Calc.ESTIMATE_KEYS) {
      const want = String(job.quotes[i][k] ?? '').trim() === '' ? undefined : Calc.money(job.quotes[i][k]);
      assert.strictEqual(back.quotes[i][k], want, `quote ${i + 1} ${k}`);
    }
  }
  assert.deepStrictEqual(Calc.estimates(back).total, Calc.estimates(job).total);
});

test('Excel: a job without estimates gets an empty Estimates sheet and no estimated profit line', async () => {
  const file = tmp('noest.xlsx');
  const plain = { ...job, quotes: job.quotes.map(({ description, amount, notes }) => ({ description, amount, notes })) };
  await exportWorkbook(plain, file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const tb = wb.getWorksheet(SHEETS.breakdown);
  assert.ok(![...Array(tb.rowCount).keys()].some(i => tb.getCell(i + 1, 1).value === 'Estimated Profit (from Estimates)'));
  const back = await importWorkbook(file);
  assert.ok(back.quotes.every(q => !Calc.hasEstimate(q)));
});

test('by item: linked costs are compared with each estimate line; the rest is shown as not linked', () => {
  const j = {
    ...job,
    labour: [{ amount: 12000, estItem: 'estCrew' }, { amount: 3000, estItem: 'estGrading' }, { amount: 500 }],
    equipment: [{ amount: 2500, estItem: 'Trucking' }], // a label typed in Excel counts too
    materials: [{ supplier: 'A', amount: 20000.25, estItem: 'estMaterial' }, { supplier: 'B', amount: 999, estItem: 'nonsense' }],
  };
  const r = Calc.estimateByItem(j);
  const get = k => r.lines.find(l => l.key === k);
  const e = Calc.estimates(j);
  // Crew Cost and Grading Labour are one item, Labour: both estimates, both kinds of cost
  assert.deepStrictEqual(r.lines.map(l => l.key), ['labour', 'estMaterial', 'estSub', 'estStone', 'estTrucking']);
  assert.strictEqual(get('labour').label, 'Labour (Crew Cost + Grading Labour)');
  assert.strictEqual(get('labour').estimated, Calc.round2(e.total.estCrew + e.total.estGrading));
  assert.strictEqual(get('labour').actual, 15000); // the rows saved as estCrew and estGrading
  assert.strictEqual(get('labour').count, 2);
  assert.strictEqual(get('labour').left, Calc.round2(e.total.estCrew + e.total.estGrading - 15000));
  assert.strictEqual(get('estMaterial').actual, 20000.25);
  assert.strictEqual(get('estTrucking').actual, 2500);
  assert.strictEqual(get('estSub').actual, 0);
  assert.strictEqual(r.unlinked.actual, 1499); // the unlinked labour row and the unknown item
  assert.strictEqual(r.unlinked.count, 2);
  const t = Calc.totals(j);
  // everything adds back up to the job's own totals
  assert.strictEqual(Calc.round2(r.lines.reduce((a, l) => a + l.actual, 0) + r.unlinked.actual), t.subtotal);
  assert.strictEqual(r.subtotal.actual, t.subtotal);
  assert.strictEqual(r.subtotal.estimated, e.total.totalCost);
  assert.strictEqual(r.overhead.actual, t.overhead);
  assert.strictEqual(r.total.actual, t.totalCosts);
  assert.strictEqual(r.total.estimated, Calc.round2(e.total.totalCost + e.total.overhead));
});

test('by item: picking an estimate item alone does not make a row count as filled in', () => {
  assert.strictEqual(Calc.isBlankRow({ id: 'r1', date: '', description: '', amount: '', estItem: 'estCrew' }), true);
  assert.strictEqual(Calc.estItemOf({ estItem: '  GRADING labour ' }), 'labour');
  assert.strictEqual(Calc.estItemOf({ estItem: 'Labour' }), 'labour');
  assert.strictEqual(Calc.estItemOf({ estItem: 'estCrew' }), 'labour');
  assert.strictEqual(Calc.estItemOf({ estItem: 'Stone' }), 'estStone');
  assert.strictEqual(Calc.estItemOf({ estItem: '' }), '');
  assert.strictEqual(Calc.estItemOf({}), '');
});

test('Excel: Estimate Item columns, dropdowns, by-item formulas, and import back', async () => {
  const j = {
    ...job,
    labour: [{ date: 'Wk 1', description: 'Crew', amount: 12000, estItem: 'labour' }, { date: 'Wk 2', description: 'Grader', amount: 3000, estItem: 'estGrading' }, { date: 'Wk 3', description: 'Misc', amount: 500 }],
    equipment: [{ date: 'Jan', description: 'Trucks', amount: 2500, estItem: 'estTrucking' }],
    materials: [{ supplier: 'A', invoiceNumber: '1', amount: 20000.25, notes: '', paid: false, estItem: 'estMaterial' }],
  };
  const file = tmp('items.xlsx');
  await exportWorkbook(j, file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const lab = wb.getWorksheet(SHEETS.labour);
  assert.strictEqual(lab.getCell('D1').value, 'Estimate Item');
  assert.strictEqual(lab.getCell('D2').value, 'Labour');
  assert.strictEqual(lab.getCell('D3').value, 'Labour'); // saved as Grading Labour before they were combined
  assert.strictEqual(lab.getCell('D4').value, '');
  assert.strictEqual(lab.getCell('D2').dataValidation.type, 'list');
  const mat = wb.getWorksheet(SHEETS.materials);
  assert.strictEqual(mat.getCell('F3').value, 'Estimate Item');
  assert.strictEqual(mat.getCell('F4').value, 'Material');
  assert.strictEqual(mat.getCell('H3').value, 'Company Totals');
  const ws = wb.getWorksheet(SHEETS.estimates);
  const rowsOf = label => [...Array(ws.rowCount).keys()].map(i => i + 1).filter(r => ws.getCell(r, 1).value === label);
  const lab2 = rowsOf('Labour (Crew Cost + Grading Labour)')[0];
  const r = Calc.estimateByItem(j);
  assert.strictEqual(ws.getCell(lab2, 3).value.result, 15000);
  const f = ws.getCell(lab2, 3).value.formula; // any name the app accepts for Labour counts
  assert.match(f, /^SUMPRODUCT\(ISNUMBER\(MATCH\(TRIM\('Labour'!D2:D4&""\),\{[^}]*\},0\)\)\*'Labour'!B2:B4\)/);
  for (const n of ['"labour"', '"crew cost"', '"grading labour"']) assert.ok(f.includes(n), n);
  // its estimate is Crew Cost + Grading Labour from the Total column
  const tcol = ws.getCell(lab2, 2).value.formula;
  assert.match(tcol, /^E3\+E6$/);
  assert.strictEqual(ws.getCell(lab2, 2).value.result, Calc.round2(Calc.estimates(j).total.estCrew + Calc.estimates(j).total.estGrading));
  assert.strictEqual(ws.getCell(rowsOf('Not linked to an estimate item')[0], 3).value.result, r.unlinked.actual);
  assert.strictEqual(ws.getCell(rowsOf('Total with overhead')[0], 3).value.result, Calc.totals(j).totalCosts);
  const back = await importWorkbook(file);
  assert.deepStrictEqual(back.labour.map(x => x.estItem), ['labour', 'labour', undefined]);
  assert.deepStrictEqual(back.equipment.map(x => x.estItem), ['estTrucking']);
  assert.deepStrictEqual(back.materials.map(x => x.estItem), ['estMaterial']);
  // the comparison rows under the estimate table aren't read back as estimates
  assert.deepStrictEqual(Calc.estimates(back).total, Calc.estimates(j).total);
  assert.deepStrictEqual(Calc.estimateByItem(back), Calc.estimateByItem(j));
});

test('Excel: an Estimate Item typed by hand (any case) is understood on import', async () => {
  const file = tmp('typed.xlsx');
  await exportWorkbook({ ...job, labour: [{ date: 'x', description: 'y', amount: 100 }] }, file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  wb.getWorksheet(SHEETS.labour).getCell('D2').value = '  grading LABOUR ';
  await wb.xlsx.writeFile(file);
  const back = await importWorkbook(file);
  assert.strictEqual(back.labour[0].estItem, 'labour');
});
