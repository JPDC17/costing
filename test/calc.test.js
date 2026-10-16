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

test('overhead percent is configurable and defaults to 12', () => {
  assert.strictEqual(Calc.newJob().overheadPercent, 12);
  assert.strictEqual(Calc.totals({ ...job, overheadPercent: 0 }).overhead, 0);
  assert.strictEqual(Calc.totals({ ...job, overheadPercent: 15 }).overhead, 3450.08);
});

test('supplier totals group invoices by company', () => {
  assert.deepStrictEqual(Calc.supplierTotals(job.materials), [
    { supplier: 'Home Depot', total: 1499.75 },
    { supplier: 'Lumber Co', total: 2500.25 },
  ]);
});

test('empty job is all zeros and margin does not divide by zero', () => {
  const t = Calc.totals(Calc.newJob());
  assert.strictEqual(t.totalCosts, 0);
  assert.strictEqual(t.margin, 0);
});

test('formatMoney', () => {
  assert.strictEqual(Calc.formatMoney(1234.5), '$1,234.50');
  assert.strictEqual(Calc.formatMoney(-20), '-$20.00');
  assert.strictEqual(Calc.formatMoney('abc'), '$0.00');
});
