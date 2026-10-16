const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { exportWorkbook, importWorkbook, SHEETS } = require('../src/excel');
const Calc = require('../src/calc');

const job = {
  ...Calc.newJob(),
  jobName: '12 Main St Reno',
  overheadPercent: 10,
  quotes: [{ description: 'Quote 1 - Framing', amount: 40000, notes: 'Signed' }, { description: 'Quote 2 - Roofing', amount: 15000, notes: '' }],
  changeOrders: [{ description: 'CO-1 Extra window', amount: 1800, notes: 'Approved by email' }],
  labour: [{ date: 'Mar 3 - Mar 7', description: 'Framing crew', amount: 9000 }],
  equipment: [{ date: 'Mar 4', description: 'Scissor lift', amount: 650 }],
  materials: [
    { supplier: 'Lumber Co', invoiceNumber: 'INV-1', amount: 7000, notes: '' },
    { supplier: 'Roof Supply', invoiceNumber: 'R-22', amount: 4200.5, notes: 'Shingles' },
    { supplier: 'Lumber Co', invoiceNumber: 'INV-2', amount: 300, notes: '' },
  ],
};

function tmp(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jobcost-')), name);
}

test('export uses the template sheet names and live formulas', async () => {
  const file = tmp('out.xlsx');
  await exportWorkbook(job, file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  assert.deepStrictEqual(wb.worksheets.map(w => w.name), Object.values(SHEETS));
  const t = Calc.totals(job);
  const tb = wb.getWorksheet(SHEETS.breakdown);
  assert.strictEqual(tb.getCell('B2').value.formula, "'Labour'!B3");
  assert.strictEqual(tb.getCell('B9').value.result, t.totalCosts);
  const profitRow = [...Array(tb.rowCount).keys()].map(i => i + 1).find(r => tb.getCell(r, 1).value === 'Profit');
  assert.strictEqual(tb.getCell(profitRow, 2).value.result, t.profit);
});

test('export then import round-trips the job', async () => {
  const file = tmp('round.xlsx');
  await exportWorkbook(job, file);
  const back = await importWorkbook(file);
  assert.strictEqual(back.jobName, job.jobName);
  assert.strictEqual(back.overheadPercent, 10);
  assert.deepStrictEqual(back.quotes, job.quotes);
  assert.deepStrictEqual(back.changeOrders, job.changeOrders);
  assert.deepStrictEqual(back.labour, job.labour);
  assert.deepStrictEqual(back.equipment, job.equipment);
  assert.deepStrictEqual(back.materials, job.materials);
  assert.deepStrictEqual(Calc.totals(back), Calc.totals(job));
});

test('imports a filled-in copy of the original Basic Tracker template', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, '..', 'templates', 'Basic_Tracker_Template.xlsx'));
  const q = wb.getWorksheet('Approved Quotes');
  q.getCell('A1').value = 'Smith Garage';
  q.getCell('A3').value = 'Garage build'; q.getCell('B3').value = 30000;
  q.getCell('A21').value = 'CO 1'; q.getCell('B21').value = 1200;
  wb.getWorksheet('Labour').getCell('A2').value = 'Week 1';
  wb.getWorksheet('Labour').getCell('B2').value = 5000;
  wb.getWorksheet('Equipment').getCell('B2').value = 300;
  const m = wb.getWorksheet('Material and Supplier Invoices');
  m.getCell('A4').value = 'Lumber Co'; m.getCell('B4').value = 'L-1'; m.getCell('C4').value = 2000;
  const file = tmp('filled.xlsx');
  await wb.xlsx.writeFile(file);

  const job2 = await importWorkbook(file);
  assert.strictEqual(job2.jobName, 'Smith Garage');
  assert.strictEqual(job2.overheadPercent, 12);
  assert.deepStrictEqual(job2.quotes, [{ description: 'Garage build', amount: 30000, notes: '' }]);
  assert.deepStrictEqual(job2.changeOrders, [{ description: 'CO 1', amount: 1200, notes: '' }]);
  assert.deepStrictEqual(job2.labour, [{ date: 'Week 1', amount: 5000, description: '' }]);
  assert.strictEqual(job2.equipment[0].amount, 300);
  assert.deepStrictEqual(job2.materials, [{ supplier: 'Lumber Co', invoiceNumber: 'L-1', amount: 2000, notes: '' }]);
});

// Every SUM in the export must not include its own cell (that is a circular reference).
function assertNoSelfReference(wb) {
  for (const ws of wb.worksheets) {
    ws.eachRow(row => row.eachCell(cell => {
      const f = cell.value && cell.value.formula;
      if (!f) return;
      for (const m of f.matchAll(/(?<![!'A-Z])\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/g)) {
        const [, c1, r1, c2, r2] = m;
        const col = cell.address.replace(/\d+/, ''), r = Number(cell.row);
        const inside = col >= c1 && col <= c2 && r >= Number(r1) && r <= Number(r2);
        assert.ok(!inside, `${ws.name}!${cell.address} (${f}) refers to itself`);
      }
    }));
  }
}

test('exporting an empty job has no circular formulas', async () => {
  const file = tmp('empty.xlsx');
  await exportWorkbook(Calc.newJob(), file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  assertNoSelfReference(wb);
  const back = await importWorkbook(file);
  assert.deepStrictEqual(Calc.totals(back), Calc.totals(Calc.newJob()));
});

test('export skips blank rows, matches supplier names literally, rounds overhead', async () => {
  const file = tmp('edge.xlsx');
  await exportWorkbook({
    ...Calc.newJob(),
    overheadPercent: 12.5,
    labour: [{ date: '', description: '', amount: '' }, { date: 'a', amount: 0.05 }],
    materials: [{ supplier: '*', amount: 7 }, { supplier: '', amount: 3 }, { supplier: 'Lumber Co ', amount: 1 }],
  }, file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  assertNoSelfReference(wb);
  assert.strictEqual(wb.getWorksheet(SHEETS.labour).getCell('A2').value, 'a');
  const m = wb.getWorksheet(SHEETS.materials);
  assert.strictEqual(m.getCell('A6').value, 'Lumber Co');
  assert.ok(!/SUMIF\(/.test(m.getCell('F4').value.formula));
  assert.strictEqual(wb.getWorksheet(SHEETS.breakdown).getCell('B7').value.formula, 'ROUND(B6*$D$6,2)');
});

test('import reads the overhead % cell if it was changed in Excel', async () => {
  const file = tmp('pct.xlsx');
  await exportWorkbook({ ...Calc.newJob(), labour: [{ date: 'x', amount: 100 }] }, file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  wb.getWorksheet(SHEETS.breakdown).getCell('D6').value = 0.15;
  await wb.xlsx.writeFile(file);
  assert.strictEqual((await importWorkbook(file)).overheadPercent, 15);
});
