// Pure costing calculations shared by the renderer, the Excel exporter and tests.
// Mirrors the formulas in the "Total Breakdown" sheet of the Basic Tracker template.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_OVERHEAD_PERCENT = 12;

  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v !== 'string') return 0;
    const n = parseFloat(v.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  // Round to cents to avoid floating point noise in displayed totals.
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function sum(rows, key = 'amount') {
    return round2((rows || []).reduce((acc, r) => acc + num(r[key]), 0));
  }

  function newJob() {
    return {
      version: 1,
      jobName: '',
      jobNumber: '',
      client: '',
      address: '',
      notes: '',
      overheadPercent: DEFAULT_OVERHEAD_PERCENT,
      quotes: [],
      changeOrders: [],
      labour: [],
      equipment: [],
      materials: [],
    };
  }

  // Fill in any missing fields so older/partial files still load.
  function normalizeJob(job) {
    const base = newJob();
    const out = Object.assign(base, job || {});
    for (const k of ['quotes', 'changeOrders', 'labour', 'equipment', 'materials']) {
      if (!Array.isArray(out[k])) out[k] = [];
    }
    if (out.overheadPercent === undefined || out.overheadPercent === null || out.overheadPercent === '') {
      out.overheadPercent = DEFAULT_OVERHEAD_PERCENT;
    }
    return out;
  }

  // Equivalent of the template's GROUPBY(Name, Amount, SUM) "Company Totals" block.
  function supplierTotals(materials) {
    const map = new Map();
    for (const m of materials || []) {
      const name = String(m.supplier || '').trim();
      if (!name && !num(m.amount)) continue;
      const key = name || '(No supplier)';
      map.set(key, (map.get(key) || 0) + num(m.amount));
    }
    return [...map.entries()]
      .map(([supplier, total]) => ({ supplier, total: round2(total) }))
      .sort((a, b) => a.supplier.localeCompare(b.supplier));
  }

  function totals(job) {
    const j = normalizeJob(job);
    const labour = sum(j.labour);
    const equipment = sum(j.equipment);
    const materials = sum(j.materials);
    const subtotal = round2(labour + equipment + materials);
    const overheadPercent = num(j.overheadPercent);
    const overhead = round2(subtotal * overheadPercent / 100);
    const totalCosts = round2(subtotal + overhead);
    const originalContract = sum(j.quotes);
    const changeOrders = sum(j.changeOrders);
    // Matches the template: change orders are tracked but not added to the contract value.
    const totalContract = originalContract;
    const profit = round2(totalContract - totalCosts);
    const margin = totalContract ? round2(profit / totalContract * 100) : 0;
    return {
      labour, equipment, materials, subtotal,
      overheadPercent, overhead, totalCosts,
      originalContract, changeOrders, totalContract,
      profit, margin,
    };
  }

  function formatMoney(n) {
    const v = round2(num(n));
    const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '-$' : '$') + s;
  }

  return { DEFAULT_OVERHEAD_PERCENT, num, round2, sum, newJob, normalizeJob, supplierTotals, totals, formatMoney };
});
