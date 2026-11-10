/* global Calc */
'use strict';

// Column definitions for each editable table, matching the template's sheets.
const TABLES = {
  quotes: {
    empty: 'No approved quotes yet.',
    cols: [
      { key: 'description', label: 'Approved Quote', type: 'text', placeholder: 'e.g. Quote #1024 – framing', width: '50%' },
      { key: 'amount', label: 'Total', type: 'money' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },
  changeOrders: {
    empty: 'No change orders yet.',
    cols: [
      { key: 'description', label: 'Change Order', type: 'text', placeholder: 'e.g. CO-01 – extra window', width: '50%' },
      { key: 'amount', label: 'Total', type: 'money' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },
  draws: {
    empty: 'No progress draws yet.',
    hideIndex: true, // the Draw # column already numbers the rows
    cols: [
      { key: 'drawNumber', label: 'Draw #', type: 'text', placeholder: '1', width: '11%' },
      { key: 'date', label: 'Date Submitted', type: 'text', placeholder: 'e.g. 2026-03-31', width: '17%' },
      { key: 'description', label: 'Description', type: 'text', placeholder: 'e.g. March progress – framing 60%', width: '34%' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'paid', label: 'Paid', type: 'check', title: 'Tick when the client has paid this draw' },
      { key: 'notes', label: 'Notes', type: 'text', placeholder: 'e.g. Cheque #1042' },
    ],
  },
  labour: {
    empty: 'No labour entries yet.',
    cols: [
      { key: 'date', label: 'Date(s)', type: 'text', placeholder: 'e.g. Mar 3 – Mar 7', width: '24%' },
      { key: 'description', label: 'Description', type: 'text', placeholder: 'Crew / trade / hours' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
  },
  equipment: {
    empty: 'No equipment entries yet.',
    cols: [
      { key: 'date', label: 'Date(s)', type: 'text', placeholder: 'e.g. Mar 3', width: '24%' },
      { key: 'description', label: 'Description', type: 'text', placeholder: 'Machine / rental' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
  },
  materials: {
    empty: 'No invoices yet.',
    cols: [
      { key: 'supplier', label: 'Name', type: 'text', placeholder: 'Supplier', list: 'suppliers', width: '26%' },
      { key: 'invoiceNumber', label: 'Invoice Number', type: 'text', width: '15%' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'paid', label: 'Paid', type: 'check', title: 'Tick when you have paid this invoice' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },
};

const state = {
  company: { name: '', address: '', phone: '', email: '', website: '', logo: '' },
  job: Calc.newJob(),
  filePath: null,
  dirty: false,
};

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const money = Calc.formatMoney;
let uid = 0;
const newId = () => `r${Date.now().toString(36)}${(uid++).toString(36)}`;

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) e.append(c);
  return e;
}

// Electron wraps errors from the main process as "Error invoking remote method '…': Error: …".
function errMsg(err) {
  return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*':\s*(\w*Error:\s*)?/, '');
}

// Something was typed in an amount cell, but it isn't a number (so it counts as $0).
function isBadAmount(value) {
  const v = String(value ?? '').trim();
  return v !== '' && Calc.num(v) === 0 && !/^[-+(]?\$?\s*0*(\.0*)?\)?$/.test(v);
}

// Amounts that aren't numbers count as $0; say so when saving or exporting.
function invalidAmountNote() {
  let n = 0;
  for (const key of Object.keys(TABLES)) for (const r of state.job[key]) if (isBadAmount(r.amount)) n++;
  if (isBadAmount(state.job.materialsRemaining)) n++;
  return n ? ` — note: ${n} amount${n === 1 ? ' isn’t a number and was' : 's aren’t numbers and were'} counted as $0 (shown in red)` : '';
}

function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(el('span', { text: msg }));
  if (action) t.append(el('button', { text: action.label, onclick: action.run }));
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), msg.length > 60 ? 8000 : 4000);
}

// ---------- State helpers ----------

function ensureIds(job) {
  for (const key of Object.keys(TABLES)) for (const r of job[key]) if (!r.id) r.id = newId();
  return job;
}

function setJob(job, filePath, dirty = false) {
  state.job = ensureIds(Calc.normalizeJob(job));
  state.filePath = filePath || null;
  state.dirty = dirty;
  renderAll();
}

function markDirty() {
  state.dirty = true;
  updateTitle();
}

function updateTitle() {
  const name = state.job.jobName || 'Untitled job';
  window.api.setTitle(`${state.dirty ? '• ' : ''}${name} — Job Costing`);
  const info = $('#fileInfo');
  if (state.filePath) {
    const base = state.filePath.split(/[\\/]/).pop();
    info.textContent = `${base}${state.dirty ? ' (unsaved changes)' : ''}`;
    info.title = state.filePath;
  } else {
    info.textContent = state.dirty ? 'Not saved yet' : '';
    info.title = '';
  }
}

// ---------- Rendering ----------

function renderTable(key) {
  const host = document.querySelector(`[data-table="${key}"]`);
  const def = TABLES[key];
  const rows = state.job[key];

  const idx = !def.hideIndex;
  const thead = el('thead', {}, el('tr', {}, [
    idx ? el('th', { class: 'num', text: '#' }) : null,
    ...def.cols.map(c => el('th', { class: c.type === 'money' ? 'money' : c.type === 'check' ? 'check' : '', text: c.label, title: c.title })),
    el('th', { class: 'act' }),
  ]));

  const tbody = el('tbody');
  rows.forEach((row, i) => tbody.append(renderRow(key, row, i)));
  if (!rows.length) {
    tbody.append(el('tr', { class: 'empty' }, el('td', { colspan: def.cols.length + (idx ? 2 : 1), text: def.empty })));
  }

  const moneyIdx = def.cols.findIndex(c => c.type === 'money');
  const tfoot = el('tfoot', {}, el('tr', {}, [
    idx ? el('td') : null,
    ...def.cols.map((c, i) => {
      if (i === moneyIdx) return el('td', { class: 'money', 'data-total': key });
      if (c.type === 'check') return el('td', { class: 'check paid-count', 'data-paidcount': key });
      if (i === 0) return el('td', { text: 'Total' });
      return el('td');
    }),
    el('td'),
  ]));

  // Fixed column widths so long text in one column doesn't squeeze the others.
  const colgroup = el('colgroup', {}, [
    idx ? el('col', { class: 'c-num' }) : null,
    ...def.cols.map(c => {
      const col = el('col', { class: c.type === 'money' ? 'c-money' : c.type === 'check' ? 'c-check' : '' });
      if (c.width) col.style.width = c.width;
      return col;
    }),
    el('col', { class: 'c-act' }),
  ]);
  const table = el('table', { class: 'grid' }, [colgroup, thead, tbody, tfoot]);
  const addBtn = el('button', { class: 'add-row', text: '+ Add row', onclick: () => addRow(key) });
  host.replaceChildren(el('div', { class: 'table-wrap' }, table), addBtn);
  updateTotals();
}

function renderRow(key, row, i) {
  const def = TABLES[key];
  const tr = el('tr', { 'data-id': row.id });
  if (!def.hideIndex) tr.append(el('td', { class: 'num', text: String(i + 1) }));
  def.cols.forEach((c, ci) => {
    if (c.type === 'check') {
      const box = el('input', { type: 'checkbox', 'aria-label': c.title || c.label, title: c.title });
      box.checked = Calc.isPaid(row);
      tr.classList.toggle('is-paid', box.checked);
      box.addEventListener('change', () => {
        row[c.key] = box.checked;
        tr.classList.toggle('is-paid', box.checked);
        markDirty();
        updateTotals();
      });
      box.addEventListener('keydown', e => onCellKey(e, key, row, ci));
      tr.append(el('td', { class: 'check' }, box));
      return;
    }
    const input = el('input', {
      type: 'text',
      class: c.type === 'money' ? 'money' : '',
      placeholder: c.type === 'money' ? '0.00' : (c.placeholder || ''),
      inputmode: c.type === 'money' ? 'decimal' : undefined,
      list: c.list,
      'aria-label': c.label,
    });
    input.value = row[c.key] ?? '';
    if (c.type === 'money' && !flagInvalid(input)) input.value = formatInput(row[c.key]);
    // Show the full text on hover when it doesn't fit in the cell.
    if (c.type !== 'money') input.title = input.value;
    input.addEventListener('input', () => {
      row[c.key] = input.value;
      if (c.type !== 'money') input.title = input.value;
      if (c.type === 'money') flagInvalid(input);
      markDirty();
      updateTotals();
    });
    if (c.type === 'money') {
      input.addEventListener('focus', () => {
        if (!input.classList.contains('invalid')) input.value = isEmpty(row[c.key]) ? '' : String(Calc.num(row[c.key]));
        input.select();
      });
      input.addEventListener('blur', () => {
        if (flagInvalid(input)) return; // keep what they typed so they can fix it
        row[c.key] = isEmpty(input.value) ? '' : Calc.money(input.value);
        input.value = formatInput(row[c.key]);
        updateTotals();
      });
    }
    input.addEventListener('keydown', e => onCellKey(e, key, row, ci));
    tr.append(el('td', { class: c.type === 'money' ? 'money' : '' }, input));
  });
  tr.append(el('td', { class: 'act' }, el('button', {
    class: 'icon danger', title: 'Delete row', 'aria-label': 'Delete row', text: '×',
    onclick: () => deleteRow(key, row.id),
  })));
  return tr;
}

function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// Highlight amounts that aren't a number (they count as $0 until fixed).
function flagInvalid(input) {
  const bad = isBadAmount(input.value);
  input.classList.toggle('invalid', bad);
  input.title = bad ? 'Not a number - this counts as $0.00' : '';
  return bad;
}

function formatInput(v) {
  if (isEmpty(v)) return '';
  const n = Calc.num(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function onCellKey(e, key, row, ci) {
  const rows = state.job[key];
  const idx = rows.indexOf(row);
  if (e.key === 'Enter') {
    e.preventDefault();
    if (idx === rows.length - 1) addRow(key, ci);
    else focusCell(key, idx + 1, ci);
  } else if (e.key === 'ArrowDown' && idx < rows.length - 1) {
    e.preventDefault(); focusCell(key, idx + 1, ci);
  } else if (e.key === 'ArrowUp' && idx > 0) {
    e.preventDefault(); focusCell(key, idx - 1, ci);
  }
}

function focusCell(key, rowIdx, colIdx) {
  const host = document.querySelector(`[data-table="${key}"]`);
  const tr = host.querySelectorAll('tbody tr')[rowIdx];
  const input = tr && tr.querySelectorAll('input')[colIdx];
  if (input) input.focus();
}

function addRow(key, focusCol = 0) {
  const row = { id: newId() };
  for (const c of TABLES[key].cols) row[c.key] = '';
  if (key === 'draws') row.drawNumber = String(nextDrawNumber());
  state.job[key].push(row);
  markDirty();
  // Add just the new row (redrawing a long table on every add is slow).
  const tbody = document.querySelector(`[data-table="${key}"] tbody`);
  if (tbody && !tbody.querySelector('tr.empty')) {
    tbody.append(renderRow(key, row, state.job[key].length - 1));
    updateTotals();
  } else {
    renderTable(key);
  }
  focusCell(key, state.job[key].length - 1, focusCol);
}

// Refresh the row numbers in the # column after a row is removed.
function renumber(key) {
  document.querySelectorAll(`[data-table="${key}"] tbody td.num`).forEach((td, i) => { td.textContent = String(i + 1); });
}

// One more than the highest draw number used so far.
function nextDrawNumber() {
  const nums = state.job.draws.map(d => parseInt(String(d.drawNumber).replace(/\D/g, ''), 10)).filter(Number.isFinite);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

function deleteRow(key, id) {
  const rows = state.job[key];
  const idx = rows.findIndex(r => r.id === id);
  if (idx < 0) return;
  const [removed] = rows.splice(idx, 1);
  markDirty();
  const tr = document.querySelector(`[data-table="${key}"] tbody tr[data-id="${CSS.escape(id)}"]`);
  if (tr && rows.length) {
    tr.remove();
    renumber(key);
    updateTotals();
  } else {
    renderTable(key);
  }
  toast('Row deleted', {
    label: 'Undo',
    run: () => {
      if (state.job[key] !== rows) return; // a different job was opened since
      rows.splice(idx, 0, removed);
      markDirty();
      renderTable(key);
      $('#toast').classList.remove('show');
    },
  });
}

function updateTotals() {
  const j = state.job;
  const t = Calc.totals(j);

  for (const key of Object.keys(TABLES)) {
    const cell = document.querySelector(`[data-total="${key}"]`);
    if (cell) cell.textContent = money(Calc.sum(j[key]));
    const pc = document.querySelector(`[data-paidcount="${key}"]`);
    if (pc) {
      const rows = j[key].filter(r => !Calc.isBlankRow(r));
      pc.textContent = rows.length ? `${rows.filter(Calc.isPaid).length}/${rows.length}` : '';
      pc.title = 'Paid / total';
    }
  }

  const pct = Calc.formatPercent;
  $('#k-contract').textContent = money(t.totalContract);
  $('#k-contract-sub').textContent = `Remaining to bill ${money(t.remainingToBill)}`;
  $('#k-draws').textContent = money(t.draws);
  $('#k-draws-sub').textContent = `${pct(t.billedPercent)} of contract · ${t.drawCount} draw${t.drawCount === 1 ? '' : 's'}`
    + (t.drawCount ? ` · ${money(t.drawsOutstanding)} not yet paid` : '');
  $('#k-costs').textContent = money(t.totalCosts);
  $('#k-costs-sub').textContent = `Includes ${t.overheadPercent}% overhead`;
  $('#k-ptd').textContent = money(t.profitToDate);
  $('#k-ptd').classList.toggle('neg', t.profitToDate < 0);
  const f = Calc.forecast(j);
  $('#k-ptd-sub').textContent = f.ready
    ? `Margin ${pct(t.marginToDate)} · Forecast ${money(f.profit)}`
    : `Margin ${pct(t.marginToDate)} · Contract profit ${money(t.profit)}`;

  $('#b-labour').textContent = money(t.labour);
  $('#b-equipment').textContent = money(t.equipment);
  $('#b-materials').textContent = money(t.materials);
  $('#b-subtotal').textContent = money(t.subtotal);
  $('#b-overhead').textContent = money(t.overhead);
  $('#b-costs').textContent = money(t.totalCosts);
  $('#b-original').textContent = money(t.originalContract);
  $('#b-co').textContent = money(t.changeOrders);
  $('#b-contract').textContent = money(t.totalContract);
  $('#b-profit').textContent = money(t.profit);
  $('#b-profit').classList.toggle('neg', t.profit < 0);
  $('#b-margin').textContent = pct(t.margin);
  $('#b-draw-count').textContent = `(${t.drawCount})`;
  $('#b-draws').textContent = money(t.draws);
  $('#b-paid-count').textContent = `(${t.drawsPaidCount} of ${t.drawCount})`;
  $('#b-draws-paid').textContent = money(t.drawsPaid);
  $('#b-draws-out').textContent = money(t.drawsOutstanding);
  $('#b-unpaid').textContent = money(t.materialsUnpaid);
  $('#b-unpaid-count').textContent = `(${t.materialsUnpaidCount} invoice${t.materialsUnpaidCount === 1 ? '' : 's'})`;
  $('#b-billed').textContent = pct(t.billedPercent);
  $('#b-remaining').textContent = money(t.remainingToBill);
  $('#b-ptd').textContent = money(t.profitToDate);
  $('#b-ptd').classList.toggle('neg', t.profitToDate < 0);
  $('#b-margin-td').textContent = pct(t.marginToDate);
  for (const r of $$('.fc-ready')) r.hidden = !f.ready;
  for (const r of $$('.fc-missing')) r.hidden = f.ready;
  $('#b-fc-days').textContent = f.ready ? `(${fmtDays(f.daysRemaining)} left)` : '';
  $('#b-fc-profit').textContent = money(f.profit);
  $('#b-fc-profit').classList.toggle('neg', f.profit < 0);
  $('#b-fc-margin').textContent = pct(f.margin);
  $('#nav-forecast').textContent = f.ready ? `Forecast ${money(f.profit)}` : 'Enter days worked';
  $('#nav-forecast').classList.toggle('neg', f.ready && f.profit < 0);
  renderForecast(t, f);

  // Progress Draws screen
  $('#d-contract').textContent = money(t.totalContract);
  $('#d-draws').textContent = money(t.draws);
  $('#d-remaining').textContent = money(t.remainingToBill);
  $('#d-remaining').classList.toggle('neg', t.remainingToBill < 0);
  $('#d-ptd').textContent = money(t.profitToDate);
  $('#d-ptd').classList.toggle('neg', t.profitToDate < 0);
  $('#d-paid').textContent = money(t.drawsPaid);
  $('#d-out').textContent = money(t.drawsOutstanding);
  // Bar: paid part, then billed-but-unpaid part, as shares of the contract.
  const clamp = v => Math.min(Math.max(v, 0), 100);
  const paidPct = t.totalContract ? t.drawsPaid / t.totalContract * 100 : 0;
  const billedPct = clamp(t.billedPercent);
  $('#d-meter-paid').style.width = `${clamp(Math.min(paidPct, billedPct))}%`;
  $('#d-meter').style.width = `${Math.max(billedPct - clamp(Math.min(paidPct, billedPct)), 0)}%`;
  $('#d-meter').classList.toggle('over', t.billedPercent > 100);
  $('#d-meter-label').textContent = t.totalContract
    ? `${pct(t.billedPercent)} of the contract billed, ${pct(paidPct)} paid${t.billedPercent > 100 ? ' — draws are more than the contract value' : ''}`
    : 'Enter approved quotes to see how much of the contract has been billed.';

  $('#nav-summary').textContent = `Profit to date ${money(t.profitToDate)}`;
  $('#nav-summary').classList.toggle('neg', t.profitToDate < 0);
  $('#nav-contract').textContent = money(t.totalContract);
  $('#nav-draws').textContent = money(t.draws);
  $('#nav-labour').textContent = money(t.labour);
  $('#nav-equipment').textContent = money(t.equipment);
  $('#nav-materials').textContent = money(t.materials);

  renderSplit(t);
  renderSuppliers();
}

function renderSplit(t) {
  const parts = [
    { label: 'Labour', value: t.labour, cls: 's1' },
    { label: 'Equipment', value: t.equipment, cls: 's2' },
    { label: 'Materials', value: t.materials, cls: 's3' },
    { label: 'Overhead', value: t.overhead, cls: 's4' },
  ];
  const total = parts.reduce((a, p) => a + Math.max(p.value, 0), 0);
  const split = $('#split');
  const legend = $('#legend');
  split.replaceChildren();
  legend.replaceChildren();
  if (!total) { split.classList.add('none'); return; }
  split.classList.remove('none');
  for (const p of parts) {
    const pct = Math.max(p.value, 0) / total * 100;
    if (pct > 0) {
      const seg = el('div', { class: `seg ${p.cls}`, title: `${p.label}: ${money(p.value)} (${pct.toFixed(1)}%)` });
      seg.style.width = `${pct}%`;
      split.append(seg);
    }
    legend.append(el('span', { class: 'lg' }, [el('i', { class: p.cls }), `${p.label} ${pct.toFixed(0)}%`]));
  }
}

function fmtDays(n) {
  const v = Calc.round(n, 2);
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} day${v === 1 ? '' : 's'}`;
}

function renderForecast(t, f) {
  const set = (id, text, neg) => { const e = $(id); e.textContent = text; e.classList.toggle('neg', !!neg); };
  const dash = '—';
  set('#fc-costs', f.ready ? money(f.totalCosts) : dash);
  set('#fc-complete', f.ready ? money(f.costToComplete) : dash);
  set('#fc-profit', f.ready ? money(f.profit) : dash, f.ready && f.profit < 0);
  set('#fc-margin', f.ready ? Calc.formatPercent(f.margin) : dash, f.ready && f.margin < 0);
  $('#fc-basis').textContent = f.ready
    ? `So far: ${money(t.labour)} labour + ${money(t.equipment)} equipment over ${fmtDays(f.daysWorked)} = ${money(f.perDay)} per day `
      + `(${money(f.labourPerDay)} labour, ${money(f.equipmentPerDay)} equipment). `
      + `Forecast covers ${fmtDays(f.totalDays)} in total. Materials are not extrapolated, so add any you still expect to buy.`
    : 'Enter the number of days worked so far and the days you expect are left. Labour and equipment are carried forward at the same cost per day.';
  $('#fc-rem-head').textContent = f.ready ? `Remaining (${fmtDays(f.daysRemaining)})` : 'Remaining';

  const cell = v => el('td', { text: f.ready ? money(v) : dash });
  const row = (label, a, b, c, cls = '') => el('tr', { class: cls }, [el('th', { text: label }), el('td', { text: money(a) }), cell(b), cell(c)]);
  // Contract, profit and margin only make sense at completion, so the To Date and
  // Remaining columns are left empty (Profit to Date from draws is on the Summary).
  const atEnd = (label, text, cls = '', neg = false) => el('tr', { class: cls }, [
    el('th', { text: label }), el('td'), el('td'), el('td', { text, class: neg ? 'neg' : '' }),
  ]);
  $('#fc-body').replaceChildren(
    row('Labour', t.labour, f.labourRemaining, f.labour),
    row('Equipment', t.equipment, f.equipmentRemaining, f.equipment),
    row('Material and Supplier', t.materials, f.materialsRemaining, f.materials),
    row('Total', t.subtotal, f.remainingSubtotal, f.subtotal, 'subtotal'),
    row(`Overhead (${t.overheadPercent}%)`, t.overhead, f.overheadRemaining, f.overhead),
    row('Total Costs', t.totalCosts, f.costToComplete, f.totalCosts, 'total'),
    el('tr', { class: 'spacer' }, el('td', { colspan: 4 })),
    atEnd('Total Contract Value', money(t.totalContract)),
    atEnd('Forecast Profit', f.ready ? money(f.profit) : dash, 'total profit-row', f.ready && f.profit < 0),
    atEnd('Forecast Margin', f.ready ? Calc.formatPercent(f.margin) : dash),
  );
}

function renderSuppliers() {
  const list = Calc.supplierTotals(state.job.materials);
  const table = $('#supplierTotals');
  const body = el('tbody');
  if (!list.length) body.append(el('tr', { class: 'empty' }, el('td', { colspan: 2, text: 'Totals by supplier appear here.' })));
  for (const s of list) body.append(el('tr', {}, [el('th', { text: s.supplier }), el('td', { text: money(s.total) })]));
  body.append(el('tr', { class: 'total' }, [el('th', { text: 'Total' }), el('td', { text: money(Calc.sum(state.job.materials)) })]));
  table.replaceChildren(body);
  const t = Calc.totals(state.job);
  $('#unpaidBox').replaceChildren(
    el('div', { class: 'unpaid-row' }, [el('span', { text: 'Paid' }), el('span', { text: money(t.materialsPaid) })]),
    el('div', { class: 'unpaid-row strong' }, [el('span', { text: `Unpaid (${t.materialsUnpaidCount})` }), el('span', { text: money(t.materialsUnpaid) })]),
  );

  // Supplier autocomplete for the invoice "Name" column.
  // Only rebuild it when the names change: rebuilding is slow on long invoice lists.
  let dl = document.getElementById('suppliers');
  if (!dl) { dl = el('datalist', { id: 'suppliers' }); document.body.append(dl); }
  const names = list.filter(s => !s.blank).map(s => s.supplier);
  const sig = names.join('\n');
  if (dl.dataset.sig !== sig) {
    dl.dataset.sig = sig;
    dl.replaceChildren(...names.map(n => el('option', { value: n })));
  }
}

function renderFields() {
  for (const input of $$('[data-field]')) input.value = state.job[input.dataset.field] || '';
  $('#jobNameTop').value = state.job.jobName || '';
  $('#overheadPercent').value = state.job.overheadPercent;
  for (const input of $$('[data-fc]')) {
    const v = state.job[input.dataset.fc];
    input.value = input.dataset.fc === 'materialsRemaining' && !isEmpty(v) && !isBadAmount(v) ? formatInput(v) : (v ?? '');
    input.classList.toggle('invalid', input.dataset.fc === 'materialsRemaining' && isBadAmount(v));
  }
}

function renderAll() {
  renderFields();
  for (const key of Object.keys(TABLES)) renderTable(key);
  updateTitle();
}

// ---------- Company details & logo ----------

// Load an image (any format the window can show), trim empty margins (transparent or
// white), shrink it to fit 800x400 and return it as a PNG data URL.
function processLogo(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || 600, h = img.naturalHeight || 300;
      if (!w || !h) return reject(new Error('That image has no size.'));
      // SVGs without a size come through tiny; draw them larger so they stay sharp.
      const scaleUp = Math.max(1, Math.min(4, 400 / Math.max(w, h)));
      w = Math.round(w * scaleUp); h = Math.round(h * scaleUp);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const empty = px[i + 3] < 12 || (px[i] > 244 && px[i + 1] > 244 && px[i + 2] > 244);
          if (!empty) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
      }
      if (x1 < 0) return reject(new Error('That image looks blank.'));
      const pad = 2;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const k = Math.min(1, 800 / cw, 400 / ch);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(cw * k)); out.height = Math.max(1, Math.round(ch * k));
      const o = out.getContext('2d'); o.imageSmoothingQuality = 'high';
      o.drawImage(c, x0, y0, cw, ch, 0, 0, out.width, out.height);
      resolve(out.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('That file isn’t an image the app can read.'));
    img.src = dataUrl;
  });
}

function renderBrand() {
  const c = state.company;
  $('#brandLogo').src = c.logo || 'logo.png';
  $('#brandLogo').classList.toggle('custom', !!c.logo);
  // A logo usually already shows the company name, so show one or the other.
  $('#brandName').textContent = c.logo ? '' : (c.name || 'Job Costing');
  $('#brandName').hidden = !!c.logo;
  $('#brand').title = c.name ? `${c.name} — Job Costing` : 'Job Costing';
  $('#nav-company').textContent = c.name || 'Add your name and logo';
}

function renderCompany() {
  const c = state.company;
  for (const input of $$('[data-company]')) input.value = c[input.dataset.company] || '';
  $('#logoPreview').hidden = !c.logo;
  if (c.logo) $('#logoPreview').src = c.logo;
  $('#logoEmpty').hidden = !!c.logo;
  $('#logoRemove').disabled = !c.logo;
  renderBrand();
}

let companyTimer = null;
function saveCompanySoon() {
  clearTimeout(companyTimer);
  $('#companySaved').textContent = 'Saving…';
  companyTimer = setTimeout(saveCompanyNow, 400);
}

async function saveCompanyNow() {
  clearTimeout(companyTimer);
  try {
    state.company = await window.api.saveCompany(state.company);
    $('#companySaved').textContent = 'Saved';
    renderBrand();
  } catch (err) {
    $('#companySaved').textContent = '';
    toast(`Could not save company details: ${errMsg(err)}`);
  }
}

async function uploadLogo() {
  try {
    const res = await window.api.pickLogo();
    if (!res) return;
    state.company.logo = await processLogo(res.dataUrl);
    renderCompany();
    await saveCompanyNow();
    toast('Logo added');
  } catch (err) {
    toast(`Could not use that logo: ${errMsg(err)}`);
  }
}

// ---------- Printable report ----------

function buildReport() {
  const j = state.job;
  const c = state.company;
  const t = Calc.totals(j);
  const f = Calc.forecast(j);
  const jobName = j.jobName || 'Untitled job';
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  // Text for the page margins on every page (see @page in styles.css).
  const css = document.documentElement.style;
  css.setProperty('--report-footer', JSON.stringify([c.name, `${jobName} — Job Cost Report`].filter(Boolean).join('  ·  ')));
  css.setProperty('--report-running', JSON.stringify(jobName));

  const neg = v => (v < 0 ? ' neg' : '');
  const pctText = Calc.formatPercent;

  // --- Letterhead: company logo and details on the left, document title on the right.
  const contact = [c.phone, c.email, c.website].filter(Boolean).join('   ·   ');
  const brand = (c.logo || c.name) ? el('div', { class: 'rp-brand' }, [
    c.logo ? el('img', { class: 'rp-logo', src: c.logo, alt: '' }) : null,
    el('div', { class: 'rp-co' }, [
      c.name ? el('div', { class: 'rp-co-name', text: c.name }) : null,
      c.address ? el('div', { class: 'rp-co-line', text: c.address.replace(/\n+/g, ', ') }) : null,
      contact ? el('div', { class: 'rp-co-line', text: contact }) : null,
    ]),
  ]) : el('div');
  const head = el('header', { class: 'rp-head' }, [
    brand,
    el('div', { class: 'rp-doc' }, [
      el('div', { class: 'rp-doc-title', text: 'Job Cost Report' }),
      el('div', { class: 'rp-doc-date', text: today }),
    ]),
  ]);

  // --- Project block
  const facts = [['Job number', j.jobNumber], ['Client', j.client], ['Site address', j.address]]
    .filter(([, v]) => String(v || '').trim());
  const project = el('section', { class: 'rp-project' }, [
    el('div', { class: 'rp-eyebrow', text: 'Project' }),
    el('h1', { text: jobName }),
    facts.length ? el('dl', { class: 'rp-facts' }, facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])) : null,
  ]);

  // --- Key figures
  const kpi = (label, value, sub, cls = '') => el('div', { class: `rp-kpi${cls}` }, [
    el('div', { class: 'rp-kpi-label', text: label }),
    el('div', { class: 'rp-kpi-value', text: value }),
    el('div', { class: 'rp-kpi-sub', text: sub }),
  ]);
  const kpis = el('section', { class: 'rp-kpis' }, [
    kpi('Contract Value', money(t.totalContract), `${pctText(t.billedPercent)} billed · ${money(t.remainingToBill)} to bill`),
    kpi('Total Costs', money(t.totalCosts), `Includes ${t.overheadPercent}% overhead`),
    kpi('Profit to Date', money(t.profitToDate), `${pctText(t.marginToDate)} margin on draws billed`, ` accent${neg(t.profitToDate)}`),
    f.ready
      ? kpi('Forecast Profit', money(f.profit), `${pctText(f.margin)} margin at completion · ${fmtDays(f.daysRemaining)} left`, neg(f.profit))
      : kpi('Contract Profit', money(t.profit), `${pctText(t.margin)} margin on costs to date`, neg(t.profit)),
  ]);

  const notes = String(j.notes || '').trim()
    ? el('section', { class: 'rp-notes' }, [el('div', { class: 'rp-eyebrow', text: 'Notes' }), el('p', { text: j.notes })])
    : null;

  // --- Financial summary: two side-by-side statements
  const row = (label, value, cls = '') => el('tr', { class: cls }, [el('th', { text: label }), el('td', { text: value })]);
  const statement = (title, rows) => el('div', { class: 'rp-statement' }, [
    el('h3', { text: title }),
    el('table', {}, el('tbody', {}, rows)),
  ]);
  const summary = el('section', { class: 'rp-section rp-keep' }, [
    el('h2', { class: 'rp-h2' }, [el('span', { text: 'Financial Summary' })]),
    el('div', { class: 'rp-two' }, [
      statement('Costs', [
        row('Labour', money(t.labour)),
        row('Equipment', money(t.equipment)),
        row('Material and Supplier', money(t.materials)),
        row('Subtotal', money(t.subtotal), 'sub'),
        row(`Overhead (${t.overheadPercent}%)`, money(t.overhead)),
        row('Total Costs', money(t.totalCosts), 'total'),
        row('Unpaid supplier invoices', `${money(t.materialsUnpaid)}`, 'note'),
      ]),
      statement('Contract & Billing', [
        row('Total Contract Value', money(t.totalContract)),
        row(`Draws submitted (${t.drawCount})`, money(t.draws)),
        row(`Paid by client (${t.drawsPaidCount} of ${t.drawCount})`, money(t.drawsPaid), 'indent'),
        row('Outstanding', money(t.drawsOutstanding), 'indent'),
        row('Remaining to bill', money(t.remainingToBill)),
        row('Profit to Date', money(t.profitToDate), `total${neg(t.profitToDate)}`),
        row('Contract profit (costs to date)', `${money(t.profit)}  ·  ${pctText(t.margin)}`, 'note'),
      ]),
    ]),
    t.changeOrders ? el('p', { class: 'rp-footnote', text: `Change orders of ${money(t.changeOrders)} are tracked separately and not included in the contract value.` }) : null,
  ]);

  // --- Forecast
  const frow = (label, a, b, cc, cls = '') => el('tr', { class: cls }, [el('th', { text: label }), el('td', { text: a }), el('td', { text: b }), el('td', { text: cc })]);
  const forecast = f.ready ? el('section', { class: 'rp-section rp-keep' }, [
    el('h2', { class: 'rp-h2' }, [el('span', { text: 'Profit Forecast' }), el('span', { class: 'rp-h2-meta', text: `${fmtDays(f.daysWorked)} worked · ${fmtDays(f.daysRemaining)} remaining` })]),
    el('p', { class: 'rp-lead', text: `Labour and equipment carried forward at ${money(f.perDay)} per day (${money(f.labourPerDay)} labour, ${money(f.equipmentPerDay)} equipment). Materials still to buy: ${money(f.materialsRemaining)}.` }),
    el('table', { class: 'rp-table rp-num3' }, [
      el('thead', {}, el('tr', {}, ['', 'To date', 'Remaining', 'At completion'].map(h => el('th', { text: h })))),
      el('tbody', {}, [
        frow('Labour', money(t.labour), money(f.labourRemaining), money(f.labour)),
        frow('Equipment', money(t.equipment), money(f.equipmentRemaining), money(f.equipment)),
        frow('Material and Supplier', money(t.materials), money(f.materialsRemaining), money(f.materials)),
        frow(`Overhead (${t.overheadPercent}%)`, money(t.overhead), money(f.overheadRemaining), money(f.overhead)),
        frow('Total Costs', money(t.totalCosts), money(f.costToComplete), money(f.totalCosts), 'total'),
        frow('Total Contract Value', '', '', money(t.totalContract)),
        frow('Forecast Profit', '', '', money(f.profit), `total${neg(f.profit)}`),
        frow('Forecast Margin', '', '', pctText(f.margin)),
      ]),
    ]),
  ]) : null;

  // --- Detail tables
  const detail = (title, key, cols, meta) => {
    const rows = j[key].filter(x => !Calc.isBlankRow(x));
    const cell = (col, text) => el('td', { class: col.money ? 'num' : col.check ? 'ctr' : '', text });
    const value = (x, col) => (col.money ? money(x[col.key]) : col.check ? (Calc.isPaid(x) ? 'Paid' : '—') : (x[col.key] || ''));
    const count = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`;
    return el('section', { class: `rp-section${rows.length <= 12 ? ' rp-keep' : ''}` }, [
      el('h2', { class: 'rp-h2' }, [el('span', { text: title }), el('span', { class: 'rp-h2-meta', text: rows.length ? `${count} · ${money(Calc.sum(rows))}` : 'None' })]),
      meta ? el('p', { class: 'rp-lead', text: meta }) : null,
      rows.length ? el('table', { class: 'rp-table' }, [
        el('colgroup', {}, cols.map(col => { const e = el('col'); if (col.w) e.style.width = col.w; return e; })),
        el('thead', {}, el('tr', {}, cols.map(col => el('th', { class: col.money ? 'num' : col.check ? 'ctr' : '', text: col.label })))),
        el('tbody', {}, rows.map(x => el('tr', { class: cols.some(col => col.check) && Calc.isPaid(x) ? 'is-paid' : '' }, cols.map(col => cell(col, value(x, col)))))),
        el('tbody', { class: 'rp-total' }, el('tr', {}, cols.map((col, i) => cell(col,
          col.money ? money(Calc.sum(rows)) : col.check ? `${rows.filter(Calc.isPaid).length} of ${rows.length}` : (i === 0 ? 'Total' : ''))))),
      ]) : null,
    ]);
  };
  const dated = [{ key: 'date', label: 'Date(s)', w: '22%' }, { key: 'description', label: 'Description' }, { key: 'amount', label: 'Amount', money: true, w: '18%' }];
  const suppliers = Calc.supplierTotals(j.materials);
  const supplierSection = suppliers.length ? el('section', { class: 'rp-section rp-keep' }, [
    el('h2', { class: 'rp-h2' }, [el('span', { text: 'Totals by Supplier' }), el('span', { class: 'rp-h2-meta', text: `${suppliers.length} ${suppliers.length === 1 ? 'company' : 'companies'}` })]),
    el('table', { class: 'rp-table rp-half' }, [
      el('thead', {}, el('tr', {}, [el('th', { text: 'Company' }), el('th', { class: 'num', text: 'Total' })])),
      el('tbody', {}, suppliers.map(x => el('tr', {}, [el('td', { text: x.supplier }), el('td', { class: 'num', text: money(x.total) })]))),
      el('tbody', { class: 'rp-total' }, el('tr', {}, [el('td', { text: 'Total' }), el('td', { class: 'num', text: money(t.materials) })])),
    ]),
  ]) : null;

  $('#report').replaceChildren(...[
    head,
    project,
    kpis,
    notes,
    summary,
    forecast,
    detail('Approved Quotes', 'quotes', [{ key: 'description', label: 'Quote' }, { key: 'notes', label: 'Notes', w: '32%' }, { key: 'amount', label: 'Amount', money: true, w: '18%' }]),
    detail('Change Orders', 'changeOrders', [{ key: 'description', label: 'Change order' }, { key: 'notes', label: 'Notes', w: '32%' }, { key: 'amount', label: 'Amount', money: true, w: '18%' }],
      j.changeOrders.some(x => !Calc.isBlankRow(x)) ? 'Tracked separately; not included in the contract value.' : ''),
    detail('Progress Draws', 'draws', [{ key: 'drawNumber', label: 'Draw', w: '8%' }, { key: 'date', label: 'Submitted', w: '14%' }, { key: 'description', label: 'Description' }, { key: 'notes', label: 'Notes', w: '20%' }, { key: 'paid', label: 'Status', check: true, w: '10%' }, { key: 'amount', label: 'Amount', money: true, w: '16%' }]),
    detail('Labour', 'labour', dated),
    detail('Equipment', 'equipment', dated),
    detail('Material and Supplier Invoices', 'materials', [{ key: 'supplier', label: 'Supplier', w: '26%' }, { key: 'invoiceNumber', label: 'Invoice', w: '14%' }, { key: 'notes', label: 'Notes' }, { key: 'paid', label: 'Status', check: true, w: '10%' }, { key: 'amount', label: 'Amount', money: true, w: '16%' }]),
    supplierSection,
    el('p', { class: 'rp-end', text: `Prepared ${today}${c.name ? ` by ${c.name}` : ''}. Figures are rounded to the cent.` }),
  ].filter(Boolean));
}

// ---------- Commands ----------

async function confirmIfDirty() {
  if (!state.dirty) return true;
  const choice = await window.api.confirmDiscard();
  if (choice === 'cancel') return false;
  if (choice === 'save') return save(false);
  return true;
}

function serialize() {
  // Store amounts as numbers in the saved file.
  const j = JSON.parse(JSON.stringify(state.job));
  for (const key of Object.keys(TABLES)) for (const r of j[key]) r.amount = isEmpty(r.amount) ? '' : Calc.money(r.amount);
  j.overheadPercent = Calc.num(j.overheadPercent);
  for (const k of ['daysWorked', 'daysRemaining']) j[k] = isEmpty(j[k]) ? '' : Calc.days(j[k]);
  j.materialsRemaining = isEmpty(j.materialsRemaining) ? '' : Calc.money(j.materialsRemaining);
  j.savedAt = new Date().toISOString();
  return j;
}

async function save(saveAs) {
  try {
    const res = await window.api.saveJob(serialize(), state.filePath, saveAs);
    if (!res) return false;
    state.filePath = res.filePath;
    state.dirty = false;
    updateTitle();
    toast(`Job saved${invalidAmountNote()}`);
    return true;
  } catch (err) {
    toast(`Could not save: ${errMsg(err)}`);
    return false;
  }
}

const commands = {
  async new() {
    if (!(await confirmIfDirty())) return;
    setJob(Calc.newJob(), null);
    switchTab('summary');
    $('[data-field="jobName"]').focus();
  },
  async open() {
    if (!(await confirmIfDirty())) return;
    try {
      const res = await window.api.openJob();
      if (res) { setJob(res.job, res.filePath); toast('Job opened'); }
    } catch (err) { toast(`Could not open file: ${errMsg(err)}`); }
  },
  save: () => save(false),
  saveAs: () => save(true),
  async importExcel() {
    if (!(await confirmIfDirty())) return;
    try {
      const res = await window.api.importExcel();
      if (!res) return;
      // An import becomes a new, unsaved job (we never overwrite the spreadsheet).
      setJob(res.job, null, true);
      const n = Object.keys(TABLES).reduce((a, k) => a + state.job[k].length, 0);
      toast(`Imported ${n} line item${n === 1 ? '' : 's'} from Excel`);
    } catch (err) { toast(`Could not import: ${errMsg(err)}`); }
  },
  async exportExcel() {
    try {
      const res = await window.api.exportExcel(serialize());
      if (res) toast(`Exported to Excel${invalidAmountNote()}`, { label: 'Show file', run: () => window.api.reveal(res.filePath) });
    } catch (err) { toast(`Could not export: ${errMsg(err)}`); }
  },
  async exportPdf() {
    buildReport();
    try {
      const res = await window.api.exportPdf(state.job.jobName || 'Untitled job');
      if (res) toast(`Report saved as PDF${invalidAmountNote()}`, { label: 'Show file', run: () => window.api.reveal(res.filePath) });
    } catch (err) { toast(`Could not export PDF: ${errMsg(err)}`); }
  },
};

function run(cmd) {
  if (commands[cmd]) commands[cmd]();
}

function switchTab(tab) {
  for (const b of $$('.nav-item')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const s of $$('.tab')) s.classList.toggle('active', s.id === `tab-${tab}`);
}

// ---------- Wiring ----------

function init() {
  for (const b of $$('[data-cmd]')) b.addEventListener('click', () => run(b.dataset.cmd));
  for (const b of $$('.nav-item')) b.addEventListener('click', () => switchTab(b.dataset.tab));

  for (const input of $$('[data-field]')) {
    input.addEventListener('input', () => {
      state.job[input.dataset.field] = input.value;
      if (input.dataset.field === 'jobName') $('#jobNameTop').value = input.value;
      markDirty();
    });
  }
  $('#jobNameTop').addEventListener('input', e => {
    state.job.jobName = e.target.value;
    $('[data-field="jobName"]').value = e.target.value;
    markDirty();
  });
  $('#overheadPercent').addEventListener('input', e => {
    state.job.overheadPercent = e.target.value;
    markDirty();
    updateTotals();
  });

  for (const input of $$('[data-fc]')) {
    const money = input.dataset.fc === 'materialsRemaining';
    input.addEventListener('input', () => {
      state.job[input.dataset.fc] = input.value;
      if (money) input.classList.toggle('invalid', isBadAmount(input.value));
      markDirty();
      updateTotals();
    });
    if (money) {
      input.addEventListener('focus', () => { if (!isBadAmount(input.value)) input.value = isEmpty(state.job.materialsRemaining) ? '' : String(Calc.num(state.job.materialsRemaining)); input.select(); });
      input.addEventListener('blur', () => { if (!isBadAmount(input.value)) input.value = formatInput(state.job.materialsRemaining); });
    }
  }
  for (const a of $$('[data-goto]')) a.addEventListener('click', e => { e.preventDefault(); switchTab(a.dataset.goto); });

  for (const input of $$('[data-company]')) {
    input.addEventListener('input', () => { state.company[input.dataset.company] = input.value; renderBrand(); saveCompanySoon(); });
  }
  $('#logoUpload').addEventListener('click', uploadLogo);
  $('#logoRemove').addEventListener('click', async () => { state.company.logo = ''; renderCompany(); await saveCompanyNow(); toast('Logo removed'); });
  window.api.getSettings().then(s => { state.company = s.company; renderCompany(); }).catch(() => renderCompany());

  window.api.onMenu(run);
  window.api.onRequestClose(async () => {
    if (await confirmIfDirty()) window.api.closeConfirmed();
  });

  setJob(Calc.newJob(), null);
}

init();
