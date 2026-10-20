const test = require('node:test');
const assert = require('node:assert');
const Calc = require('../src/calc');

const job = {
  overheadPercent: 12,
  quotes: [{ amount: 50000 }, { amount: '10,000.00' }],
  changeOrders: [{ amount: 2500 }],
  labour: [{ amount: 12000 }, { amount: 3000.5 }],
  equipment: [{ amount: 4000 }],
  materials: [
    { supplier: 'Home Depot', amount: 1000 },
    { supplier: 'Lumber Co', amount: 2500.25 },
    { supplier: 'Home Depot', amount: '$499.75' },
  ],
};

test('totals follow the template Total Breakdown formulas', () => {
  const t = Calc.totals(job);
  assert.strictEqual(t.labour, 15000.5);
  assert.strictEqual(t.equipment, 4000);
  assert.strictEqual(t.materials, 4000);
  assert.strictEqual(t.subtotal, 23000.5);
  assert.strictEqual(t.overhead, 2760.06); // 12% of subtotal
  assert.strictEqual(t.totalCosts, 25760.56);
  assert.strictEqual(t.originalContract, 60000);
  assert.strictEqual(t.changeOrders, 2500);
  assert.strictEqual(t.totalContract, 60000); // change orders not included, as in the template
  assert.strictEqual(t.profit, 34239.44);
});

test('progress draws give billed to date and profit to date', () => {
  const t = Calc.totals({ ...job, draws: [{ amount: 20000 }, { amount: '10,500.50' }, { drawNumber: '', amount: '' }] });
  // costs are 25760.56 and the contract is 60000 (from the job above)
  assert.strictEqual(t.draws, 30500.5);
  assert.strictEqual(t.drawCount, 2); // the untouched row isn't counted
  assert.strictEqual(Calc.formatPercent(t.billedPercent), '50.8%');
  assert.strictEqual(t.remainingToBill, 29499.5);
  assert.strictEqual(t.profitToDate, 4739.94);
  assert.strictEqual(Calc.formatPercent(t.marginToDate), '15.5%');
  assert.strictEqual(t.profit, 34239.44); // projected profit is unchanged by draws
});

test('no draws yet: profit to date is minus the costs, margin is 0', () => {
  const t = Calc.totals(job);
  assert.strictEqual(t.draws, 0);
  assert.strictEqual(t.profitToDate, -25760.56);
  assert.strictEqual(t.marginToDate, 0);
  assert.strictEqual(t.billedPercent, 0);
});

test('older job files without draws still load', () => {
  const old = { jobName: 'Old', quotes: [{ amount: 5 }] };
  assert.deepStrictEqual(Calc.normalizeJob(old).draws, []);
});

test('overhead percent is configurable and defaults to 12', () => {
  assert.strictEqual(Calc.newJob().overheadPercent, 12);
  assert.strictEqual(Calc.totals({ ...job, overheadPercent: 0 }).overhead, 0);
  assert.strictEqual(Calc.totals({ ...job, overheadPercent: 15 }).overhead, 3450.08);
});

test('supplier totals group invoices by company', () => {
  assert.deepStrictEqual(Calc.supplierTotals(job.materials), [
    { supplier: 'Home Depot', total: 1499.75, blank: false },
    { supplier: 'Lumber Co', total: 2500.25, blank: false },
  ]);
});

test('supplier totals ignore case and spaces, and group blank names last', () => {
  const list = Calc.supplierTotals([
    { supplier: 'Lumber Co', amount: 10 },
    { supplier: ' lumber co ', amount: 5 },
    { supplier: '', amount: 3 },
    { supplier: 'Abc', amount: 1 },
    { supplier: '', amount: '' }, // untouched row: skipped
  ]);
  assert.deepStrictEqual(list, [
    { supplier: 'Abc', total: 1, blank: false },
    { supplier: 'Lumber Co', total: 15, blank: false },
    { supplier: '(No supplier)', total: 3, blank: true },
  ]);
});

test('num parses typed amounts', () => {
  assert.strictEqual(Calc.num('$1,234.50'), 1234.5);
  assert.strictEqual(Calc.num('(250)'), -250);
  assert.strictEqual(Calc.num('-12.5'), -12.5);
  assert.strictEqual(Calc.num('.5'), 0.5);
  assert.strictEqual(Calc.num('12abc'), 0);
  assert.strictEqual(Calc.num(''), 0);
  assert.strictEqual(Calc.num(null), 0);
});

test('isBlankRow', () => {
  assert.strictEqual(Calc.isBlankRow({ id: 'x', date: '', description: ' ', amount: '' }), true);
  assert.strictEqual(Calc.isBlankRow({ id: 'x', date: '', amount: 0 }), true);
  assert.strictEqual(Calc.isBlankRow({ id: 'x', date: 'Mar 3', amount: 0 }), false);
  assert.strictEqual(Calc.isBlankRow({ id: 'x', amount: 5 }), false);
});

test('totals with cents, negatives and fractional overhead', () => {
  const t = Calc.totals({
    overheadPercent: 12.5,
    quotes: [{ amount: 1000.01 }],
    labour: [{ amount: 0.1 }, { amount: 0.2 }],
    equipment: [{ amount: '(50)' }],
    materials: [{ amount: 27 }],
  });
  assert.strictEqual(t.labour, 0.3);
  assert.strictEqual(t.subtotal, -22.7);
  assert.strictEqual(t.overhead, -2.84);
  assert.strictEqual(t.totalCosts, -25.54);
  assert.strictEqual(t.profit, 1025.55);
});

test('empty job is all zeros and margin does not divide by zero', () => {
  const t = Calc.totals(Calc.newJob());
  assert.strictEqual(t.totalCosts, 0);
  assert.strictEqual(t.margin, 0);
});

test('round2 matches Excel ROUND(x, 2)', () => {
  assert.strictEqual(Calc.round2(1.005), 1.01);
  assert.strictEqual(Calc.round2(2.675), 2.68);
  assert.strictEqual(Calc.round2(-2.835), -2.84);
  assert.strictEqual(Calc.round2(0.1 + 0.2), 0.3);
  assert.strictEqual(Calc.round2(-0.001), 0);
  assert.strictEqual(Calc.round2(4503.348), 4503.35);
});

test('formatPercent rounds once from the exact value', () => {
  // 67.5516 must show 67.6%; rounding to 67.55 first would show 67.5%
  assert.strictEqual(Calc.formatPercent(67.55159673548094), '67.6%');
  assert.strictEqual(Calc.formatPercent(30.5268), '30.5%');
  assert.strictEqual(Calc.formatPercent(-19.25), '-19.3%');
  assert.strictEqual(Calc.formatPercent(0), '0.0%');
});

test('formatMoney', () => {
  assert.strictEqual(Calc.formatMoney(1234.5), '$1,234.50');
  assert.strictEqual(Calc.formatMoney(-20), '-$20.00');
  assert.strictEqual(Calc.formatMoney('abc'), '$0.00');
});

test('damaged job files: rows that are not objects are dropped', () => {
  const j = Calc.normalizeJob({ labour: [null, 5, 'x', [1], { amount: 10 }], draws: 'nope' });
  assert.deepStrictEqual(j.labour, [{ amount: 10 }]);
  assert.deepStrictEqual(j.draws, []);
  assert.strictEqual(Calc.totals(j).labour, 10);
});
