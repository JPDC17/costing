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
    let s = v.replace(/[$,\s]/g, '');
    // Accounting style negatives, e.g. "(250.00)".
    const neg = /^\(.*\)$/.test(s);
    if (neg) s = s.slice(1, -1);
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return 0;
    const n = parseFloat(s);
    return neg ? -n : n;
  }

  // A row the user added but never filled in.
  function isBlankRow(row) {
    return Object.entries(row || {}).every(([k, v]) =>
      k === 'id' || (k === 'amount' ? !num(v) : !String(v ?? '').trim()));
  }

  // Round to cents the way Excel's ROUND(x, 2) does: halves go away from zero, and
  // floating point noise is removed first so 1.005 rounds to 1.01.
  function round2(n) {
    if (!Number.isFinite(n)) return 0;
    const cents = Math.round(parseFloat((Math.abs(n) * 100).toPrecision(15)));
    return (n < 0 ? -cents : cents) / 100 || 0;
  }

  // Each line is rounded to cents first, exactly as it is written to Excel.
  function money(v) {
    return round2(num(v));
  }

  function sum(rows, key = 'amount') {
    return round2((rows || []).reduce((acc, r) => acc + money(r[key]), 0));
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

  const NO_SUPPLIER = '(No supplier)';

  // Equivalent of the template's GROUPBY(Name, Amount, SUM) "Company Totals" block.
  // Names are matched ignoring case and surrounding spaces (like Excel does), so
  // "Lumber Co" and "lumber co " count as the same company.
  function supplierTotals(materials) {
    const map = new Map();
    for (const m of materials || []) {
      if (isBlankRow(m)) continue;
      const name = String(m.supplier || '').trim();
      const key = name.toLowerCase();
      const entry = map.get(key) || { supplier: name || NO_SUPPLIER, total: 0, blank: !name };
      entry.total += money(m.amount);
      map.set(key, entry);
    }
    return [...map.values()]
      .map(e => ({ supplier: e.supplier, total: round2(e.total), blank: e.blank }))
      .sort((a, b) => (a.blank - b.blank) || a.supplier.localeCompare(b.supplier, undefined, { sensitivity: 'base' }));
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

  return { DEFAULT_OVERHEAD_PERCENT, NO_SUPPLIER, num, round2, money, sum, isBlankRow, newJob, normalizeJob, supplierTotals, totals, formatMoney };
});
