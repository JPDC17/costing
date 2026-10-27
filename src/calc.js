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

  // A row the user added but never filled in. The draw number is filled in
  // automatically, so it doesn't count.
  function isBlankRow(row) {
    return Object.entries(row || {}).every(([k, v]) =>
      k === 'id' || k === 'drawNumber' || (k === 'amount' ? !num(v) : !String(v ?? '').trim()));
  }

  // Round to cents the way Excel's ROUND(x, 2) does: halves go away from zero, and
  // floating point noise is removed first so 1.005 rounds to 1.01.
  function round(n, places) {
    if (!Number.isFinite(n)) return 0;
    const f = 10 ** places;
    const units = Math.round(parseFloat((Math.abs(n) * f).toPrecision(15)));
    return (n < 0 ? -units : units) / f || 0;
  }

  function round2(n) {
    return round(n, 2);
  }

  // Each line is rounded to cents first, exactly as it is written to Excel.
  function money(v) {
    return round2(num(v));
  }

  function sum(rows, key = 'amount') {
    return round2((rows || []).reduce((acc, r) => acc + money(r[key]), 0));
  }

  // Every list of line items in a job.
  const LIST_KEYS = ['quotes', 'changeOrders', 'draws', 'labour', 'equipment', 'materials'];

  function newJob() {
    return {
      version: 1,
      jobName: '',
      jobNumber: '',
      client: '',
      address: '',
      notes: '',
      overheadPercent: DEFAULT_OVERHEAD_PERCENT,
      // Profit forecast inputs
      daysWorked: '',
      daysRemaining: '',
      materialsRemaining: '',
      quotes: [],
      changeOrders: [],
      draws: [],
      labour: [],
      equipment: [],
      materials: [],
    };
  }

  // Fill in any missing fields so older/partial files still load.
  function normalizeJob(job) {
    const base = newJob();
    const out = Object.assign(base, job || {});
    for (const k of LIST_KEYS) {
      // Drop anything that isn't a row, so a damaged file can't break the totals.
      out[k] = Array.isArray(out[k]) ? out[k].filter(r => r && typeof r === 'object' && !Array.isArray(r)) : [];
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
    // Projected profit: what the job makes once the whole contract is billed.
    const profit = round2(totalContract - totalCosts);
    // Percentages are kept exact and only rounded when shown (rounding twice can be off by 0.1%).
    const margin = totalContract ? profit / totalContract * 100 : 0;
    // Profit to date: what has actually been billed through progress draws, less costs so far.
    const draws = sum(j.draws);
    const drawCount = j.draws.filter(d => !isBlankRow(d)).length;
    const billedPercent = totalContract ? draws / totalContract * 100 : 0;
    const remainingToBill = round2(totalContract - draws);
    const profitToDate = round2(draws - totalCosts);
    const marginToDate = draws ? profitToDate / draws * 100 : 0;
    return {
      labour, equipment, materials, subtotal,
      overheadPercent, overhead, totalCosts,
      originalContract, changeOrders, totalContract,
      profit, margin,
      draws, drawCount, billedPercent, remainingToBill, profitToDate, marginToDate,
    };
  }

  // Days can't be negative; anything that isn't a number counts as 0.
  function days(v) {
    const n = num(v);
    return n > 0 ? n : 0;
  }

  // Profit forecast: carry the labour and equipment cost per day forward over the
  // days left, add any materials still to buy, then apply overhead as usual.
  function forecast(job) {
    const j = normalizeJob(job);
    const t = totals(j);
    const daysWorked = days(j.daysWorked);
    const daysRemaining = days(j.daysRemaining);
    const materialsRemaining = money(j.materialsRemaining);
    const ready = daysWorked > 0;
    // Same order of operations as the Excel formula ROUND(cost*remaining/worked, 2).
    const ahead = cost => (ready ? round2(cost * daysRemaining / daysWorked) : 0);
    const labourPerDay = ready ? t.labour / daysWorked : 0;
    const equipmentPerDay = ready ? t.equipment / daysWorked : 0;
    const labourRemaining = ahead(t.labour);
    const equipmentRemaining = ahead(t.equipment);
    const labour = round2(t.labour + labourRemaining);
    const equipment = round2(t.equipment + equipmentRemaining);
    const materials = round2(t.materials + materialsRemaining);
    const subtotal = round2(labour + equipment + materials);
    const overhead = round2(subtotal * t.overheadPercent / 100);
    const totalCosts = round2(subtotal + overhead);
    const profit = round2(t.totalContract - totalCosts);
    return {
      ready, daysWorked, daysRemaining, totalDays: daysWorked + daysRemaining,
      labourPerDay, equipmentPerDay, perDay: labourPerDay + equipmentPerDay,
      labourRemaining, equipmentRemaining, materialsRemaining,
      remainingSubtotal: round2(labourRemaining + equipmentRemaining + materialsRemaining),
      overheadRemaining: round2(overhead - t.overhead),
      costToComplete: round2(totalCosts - t.totalCosts),
      labour, equipment, materials, subtotal, overhead, totalCosts,
      totalContract: t.totalContract,
      profit,
      margin: t.totalContract ? profit / t.totalContract * 100 : 0,
    };
  }

  // e.g. 67.5516 -> "67.6%"
  function formatPercent(n) {
    return `${round(num(n), 1).toFixed(1)}%`;
  }

  function formatMoney(n) {
    const v = round2(num(n));
    const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '-$' : '$') + s;
  }

  return { DEFAULT_OVERHEAD_PERCENT, NO_SUPPLIER, LIST_KEYS, num, round, round2, money, sum, isBlankRow, newJob, normalizeJob, supplierTotals, totals, forecast, days, formatMoney, formatPercent };
});
