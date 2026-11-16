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
