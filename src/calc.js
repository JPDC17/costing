// Pure costing calculations shared by the renderer, the Excel exporter and tests.
// Mirrors the formulas in the "Total Breakdown" sheet of the Basic Tracker template.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_OVERHEAD_PERCENT = 12;
  const DEFAULT_HOLDBACK_PERCENT = 10;

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
  // automatically and a Paid tick on its own isn't an entry, so neither counts.
  function isBlankRow(row) {
    return Object.entries(row || {}).every(([k, v]) =>
      k === 'id' || k === 'drawNumber' || k === 'paid' || k === 'estItem' || (isMoneyKey(k) ? !num(v) : !String(v ?? '').trim()));
  }
  const isMoneyKey = k => k === 'amount' || ESTIMATE_KEYS.includes(k);

  // Estimated costs entered for each approved quote (the Estimates screen). They're
  // stored on the quote's own row, so they stay with it when quotes are reordered.
  // Total Cost = the six cost lines; Profit = Bid Price - Total Cost - Overhead.
  const ESTIMATE_LINES = [
    { key: 'estCrew', label: 'Crew Cost' },
    { key: 'estMaterial', label: 'Material' },
    { key: 'estSub', label: 'Sub Cost' },
    { key: 'estGrading', label: 'Grading Labour' },
    { key: 'estStone', label: 'Stone' },
    { key: 'estTrucking', label: 'Trucking' },
  ];
  const ESTIMATE_KEYS = [...ESTIMATE_LINES.map(l => l.key), 'estOverhead'];

  // Ticked as paid in the app, or Yes / Y / Paid / x / ✓ typed in an Excel Paid cell
  // (any case, spaces ignored). The Excel export's formulas accept exactly the same.
  const PAID_WORDS = ['yes', 'y', 'paid', 'x', '✓'];
  function isPaid(row) {
    const v = row && row.paid;
    return v === true || (typeof v === 'string' && PAID_WORDS.includes(v.trim().toLowerCase()));
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
      // Holdback: the share of each progress draw the client keeps until the job is done.
      holdbackPercent: DEFAULT_HOLDBACK_PERCENT,
      holdbackReceived: '',
      holdbackDue: '',
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
    // Jobs saved before holdback was tracked had none, so their figures don't change.
    if (job && typeof job === 'object' && !('holdbackPercent' in job)) out.holdbackPercent = 0;
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
    // Payments: profit above counts everything billed or received; these track the cash.
    // Holdback is worked out per draw (rounded to the cent, as in Excel). The client pays
    // each draw less its holdback, so "paid" and "outstanding" are net of holdback; the
    // holdback itself is owed to you until it's released. Profit still counts the full draw.
    const holdbackPercent = Math.min(Math.max(num(j.holdbackPercent), 0), 100);
    const holdbackOf = d => round2(money(d.amount) * holdbackPercent / 100);
    const netOf = d => round2(money(d.amount) - holdbackOf(d));
    const drawsHoldback = round2(j.draws.reduce((a, d) => a + holdbackOf(d), 0));
    const drawsNet = round2(draws - drawsHoldback);
    const drawsPaid = round2(j.draws.filter(isPaid).reduce((a, d) => a + netOf(d), 0));
    const drawsOutstanding = round2(drawsNet - drawsPaid);
    const holdbackReceived = money(j.holdbackReceived);
    const holdbackOwed = round2(drawsHoldback - holdbackReceived);
    const drawsPaidCount = j.draws.filter(d => isPaid(d) && !isBlankRow(d)).length;
    const materialsPaid = sum(j.materials.filter(isPaid));
    const materialsUnpaid = round2(materials - materialsPaid);
    const materialsUnpaidCount = j.materials.filter(m => !isPaid(m) && !isBlankRow(m)).length;
    return {
      labour, equipment, materials, subtotal,
      overheadPercent, overhead, totalCosts,
      originalContract, changeOrders, totalContract,
      profit, margin,
      draws, drawCount, billedPercent, remainingToBill, profitToDate, marginToDate,
      drawsPaid, drawsOutstanding, drawsPaidCount, materialsPaid, materialsUnpaid, materialsUnpaidCount,
      holdbackPercent, drawsHoldback, drawsNet, holdbackReceived, holdbackOwed,
    };
  }

  // A quote counts as estimated once any estimate figure has been entered (even 0).
  function hasEstimate(q) {
    return ESTIMATE_KEYS.some(k => String((q && q[k]) ?? '').trim() !== '');
  }

  function estimateOf(q) {
    const lines = Object.fromEntries(ESTIMATE_LINES.map(l => [l.key, money(q[l.key])]));
    const totalCost = round2(ESTIMATE_LINES.reduce((a, l) => a + lines[l.key], 0));
    const overhead = money(q.estOverhead);
    const bid = money(q.amount);
    const profit = round2(bid - totalCost - overhead);
    return { ...lines, totalCost, overhead, bid, profit, margin: bid ? profit / bid * 100 : 0 };
  }

  // Estimates for every approved quote, their total, and how the job is doing against
  // them. The total only includes quotes that have an estimate, so a quote without one
  // doesn't count its whole price as profit. Actual costs are compared before overhead
  // (direct costs), since the estimate's overhead may be worked out differently.
  function estimates(job) {
    const j = normalizeJob(job);
    const t = totals(j);
    const quotes = j.quotes.filter(q => !isBlankRow(q)).map(q => ({
      id: q.id, description: String(q.description || ''), estimated: hasEstimate(q), ...estimateOf(q),
    }));
    const done = quotes.filter(q => q.estimated);
    const add = key => round2(done.reduce((a, q) => a + q[key], 0));
    const total = Object.fromEntries([...ESTIMATE_LINES.map(l => l.key), 'totalCost', 'overhead', 'bid', 'profit'].map(k => [k, add(k)]));
    total.margin = total.bid ? total.profit / total.bid * 100 : 0;
    return {
      quotes, total,
      count: done.length, quoteCount: quotes.length, any: done.length > 0, complete: quotes.length > 0 && done.length === quotes.length,
      actualDirect: t.subtotal,
      usedPercent: total.totalCost ? t.subtotal / total.totalCost * 100 : 0,
      remaining: round2(total.totalCost - t.subtotal),
      billedPercent: t.billedPercent,
    };
  }

  // The items a labour, equipment or invoice row can be linked to, and the estimate
  // lines each one is compared with. Crew Cost and Grading Labour are both labour, so
  // they're one item: Labour.
  const COST_KEYS = ['labour', 'equipment', 'materials'];
  const COST_ITEMS = [
    { key: 'labour', label: 'Labour', lines: ['estCrew', 'estGrading'], detail: 'Crew Cost + Grading Labour' },
    { key: 'estMaterial', label: 'Material', lines: ['estMaterial'] },
    { key: 'estSub', label: 'Sub Cost', lines: ['estSub'] },
    { key: 'estStone', label: 'Stone', lines: ['estStone'] },
    { key: 'estTrucking', label: 'Trucking', lines: ['estTrucking'] },
  ];
  // Other names accepted for an item: its estimate lines' keys and labels (so files
  // saved when Crew Cost and Grading Labour were separate still count as Labour).
  const ITEM_NAMES = new Map();
  for (const it of COST_ITEMS) {
    for (const n of [it.key, it.label, ...it.lines, ...it.lines.map(k => ESTIMATE_LINES.find(l => l.key === k).label)]) ITEM_NAMES.set(n.toLowerCase(), it.key);
  }
  ITEM_NAMES.set('labor', 'labour');
  // Every name each item answers to (lower case), for the Excel formulas.
  for (const it of COST_ITEMS) it.names = [...ITEM_NAMES].filter(([, k]) => k === it.key).map(([n]) => n);
  // The item a row is linked to: its estItem, or the name typed in Excel (any case,
  // spaces ignored). '' = not linked.
  function estItemOf(row) {
    const v = String((row && row.estItem) ?? '').trim().toLowerCase();
    return (v && ITEM_NAMES.get(v)) || '';
  }
  const itemLabel = key => { const it = COST_ITEMS.find(i => i.key === key); return it ? it.label : ''; };

  // Estimate vs actual for each estimate line. Estimated = the line's total over the
  // quotes that have an estimate; actual = the cost rows linked to that line. Costs not
  // linked to any line are shown separately so the totals still add up. Overhead
  // compares the estimate's overhead with the app's overhead on actual costs.
  function estimateByItem(job) {
    const j = normalizeJob(job);
    const t = totals(j);
    const e = estimates(j);
    const actual = Object.fromEntries(COST_ITEMS.map(l => [l.key, 0]));
    const counts = Object.fromEntries(COST_ITEMS.map(l => [l.key, 0]));
    let unlinkedCount = 0;
    for (const k of COST_KEYS) {
      for (const r of j[k]) {
        if (isBlankRow(r)) continue;
        const item = estItemOf(r);
        if (item) { actual[item] += money(r.amount); counts[item]++; } else unlinkedCount++;
      }
    }
    const row = (key, label, estimated, act, count) => ({
      key, label, estimated, actual: act, count,
      left: round2(estimated - act),
      usedPercent: estimated ? act / estimated * 100 : 0,
    });
    const lines = COST_ITEMS.map(it => ({
      ...row(it.key, it.detail ? `${it.label} (${it.detail})` : it.label, round2(it.lines.reduce((a, k) => a + e.total[k], 0)), round2(actual[it.key]), counts[it.key]),
      name: it.label, estimateLines: it.lines,
    }));
    const linked = round2(lines.reduce((a, l) => a + l.actual, 0));
    const unlinked = row('', 'Not linked to an estimate item', 0, round2(t.subtotal - linked), unlinkedCount);
    const subtotal = row('subtotal', 'Total before overhead', e.total.totalCost, t.subtotal, 0);
    const overhead = row('overhead', 'Overhead', e.total.overhead, t.overhead, 0);
    const total = row('total', 'Total with overhead', round2(e.total.totalCost + e.total.overhead), t.totalCosts, 0);
    return { lines, unlinked, subtotal, overhead, total, linkedCount: lines.reduce((a, l) => a + l.count, 0), any: e.any };
  }

  // How the job is doing, in one line, for the Summary and the start screen.
  // level: 'empty' (nothing entered), 'good', 'watch' or 'bad'.
  // With an estimate: compares the share of the estimate spent with the share of the
  // contract billed (on track within 5 points; watch up to 15; beyond that, or over the
  // estimate, needs attention). Without one: profit to date and the forecast.
  const HEALTH_WATCH = 5, HEALTH_BAD = 15;
  function health(job) {
    const j = normalizeJob(job);
    const t = totals(j);
    const e = estimates(j);
    const f = forecast(j);
    const pct = formatPercent, m = formatMoney;
    const over = e.any ? estimateByItem(j).lines.filter(l => l.estimated && l.left < 0).map(l => l.name) : [];
    const overText = over.length ? ` Over the estimate on ${over.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : '';
    const profitText = ` Profit to date is ${m(t.profitToDate)}.`;
    if (!t.subtotal && !t.draws && !t.totalContract) {
      return { level: 'empty', title: 'Nothing entered yet', detail: 'Add your approved quotes, estimate and costs to see how this job is doing.', over };
    }
    if (f.ready && f.profit < 0) {
      return { level: 'bad', title: 'Needs attention: forecast to lose money', detail: `At the current cost per day the job finishes ${m(-f.profit)} short of the contract value.${overText}${profitText}`, over };
    }
    if (e.any) {
      const gap = e.usedPercent - e.billedPercent;
      const base = `${pct(e.usedPercent)} of the estimated cost is spent and ${pct(e.billedPercent)} of the contract is billed.`;
      if (e.remaining < 0) return { level: 'bad', title: 'Needs attention: costs are over the estimate', detail: `${base} Actual costs are ${m(-e.remaining)} over the estimate.${overText}${profitText}`, over };
      if (gap > HEALTH_BAD) return { level: 'bad', title: 'Needs attention: costs are running ahead of billing', detail: `${base}${overText}${profitText}`, over };
      if (gap > HEALTH_WATCH) return { level: 'watch', title: 'Watch: costs are a little ahead of billing', detail: `${base}${overText}${profitText}`, over };
      return { level: 'good', title: 'On track', detail: `${base}${overText}${profitText}`, over };
    }
    if (t.profitToDate < 0) {
      return { level: 'watch', title: 'Watch: billing is behind costs', detail: `Costs so far are ${m(-t.profitToDate)} more than the draws billed. Add your estimate to see whether that's expected.`, over };
    }
    return { level: 'good', title: 'Profitable so far', detail: `Profit to date is ${m(t.profitToDate)} (${pct(t.marginToDate)} of draws billed). Add your estimate to track costs against it.`, over };
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

  return { DEFAULT_OVERHEAD_PERCENT, DEFAULT_HOLDBACK_PERCENT, HEALTH_WATCH, HEALTH_BAD, health, NO_SUPPLIER, LIST_KEYS, PAID_WORDS, ESTIMATE_LINES, ESTIMATE_KEYS, COST_KEYS, COST_ITEMS, hasEstimate, estimateOf, estimates, estItemOf, itemLabel, estimateByItem, num, round, round2, money, sum, isBlankRow, isPaid, newJob, normalizeJob, supplierTotals, totals, forecast, days, formatMoney, formatPercent };
});
