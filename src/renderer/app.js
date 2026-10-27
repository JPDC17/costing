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
      { key: 'notes', label: 'Notes', type: 'text', placeholder: 'e.g. Paid Apr 15' },
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
      { key: 'supplier', label: 'Name', type: 'text', placeholder: 'Supplier', list: 'suppliers', width: '30%' },
      { key: 'invoiceNumber', label: 'Invoice Number', type: 'text', width: '17%' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },
};

const state = {
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
    ...def.cols.map(c => el('th', { class: c.type === 'money' ? 'money' : '', text: c.label })),
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
      if (i === 0) return el('td', { text: 'Total' });
      return el('td');
    }),
    el('td'),
  ]));

  // Fixed column widths so long text in one column doesn't squeeze the others.
  const colgroup = el('colgroup', {}, [
    idx ? el('col', { class: 'c-num' }) : null,
    ...def.cols.map(c => {
      const col = el('col', { class: c.type === 'money' ? 'c-money' : '' });
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
  }

  const pct = Calc.formatPercent;
  $('#k-contract').textContent = money(t.totalContract);
  $('#k-contract-sub').textContent = `Remaining to bill ${money(t.remainingToBill)}`;
  $('#k-draws').textContent = money(t.draws);
  $('#k-draws-sub').textContent = `${pct(t.billedPercent)} of contract · ${t.drawCount} draw${t.drawCount === 1 ? '' : 's'}`;
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
  $('#d-meter').style.width = `${Math.min(Math.max(t.billedPercent, 0), 100)}%`;
  $('#d-meter').classList.toggle('over', t.billedPercent > 100);
  $('#d-meter-label').textContent = t.totalContract
    ? `${pct(t.billedPercent)} of the contract billed${t.billedPercent > 100 ? ' — draws are more than the contract value' : ''}`
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

// ---------- Printable report ----------

function buildReport() {
  const j = state.job;
  const t = Calc.totals(j);
  const r = $('#report');
  const td = (c, text) => el('td', { class: c.money ? 'm' : '', text });
  const rowsTable = (title, key, cols, hint) => {
    const rows = j[key].filter(x => !Calc.isBlankRow(x));
    return el('div', { class: 'r-section' }, [
      el('h3', {}, [title, hint ? el('span', { class: 'muted r-hint', text: ` ${hint}` }) : null]),
      el('table', {}, [
        el('thead', {}, el('tr', {}, cols.map(c => el('th', { class: c.money ? 'm' : '', text: c.label })))),
        el('tbody', {}, rows.length
          ? rows.map(x => el('tr', {}, cols.map(c => td(c, c.money ? money(x[c.key]) : (x[c.key] || '')))))
          : [el('tr', {}, el('td', { colspan: cols.length, class: 'muted', text: 'None' }))]),
        el('tbody', { class: 'r-total' }, el('tr', {}, cols.map((c, i) => td(c, c.money ? money(Calc.sum(rows)) : (i === 0 ? 'Total' : ''))))),
      ]),
    ]);
  };
  const line = (label, value, cls = '') => el('tr', { class: cls }, [el('th', { text: label }), el('td', { class: 'm', text: value })]);

  const details = [
    ['Job number', j.jobNumber], ['Client', j.client], ['Site address', j.address],
  ].filter(([, v]) => String(v || '').trim()).map(([k, v]) => el('div', {}, [el('b', { text: `${k}: ` }), v]));

  const suppliers = Calc.supplierTotals(j.materials);
  const f = Calc.forecast(j);
  const fline = (label, a, b, c, cls = '') => el('tr', { class: cls }, [el('th', { text: label }), el('td', { class: 'm', text: a }), el('td', { class: 'm', text: b }), el('td', { class: 'm', text: c })]);
  const forecastSection = f.ready ? el('div', { class: 'r-section r-keep' }, [
    el('h3', {}, ['Profit Forecast', el('span', { class: 'muted r-hint', text: ` (${fmtDays(f.daysWorked)} worked, ${fmtDays(f.daysRemaining)} remaining)` })]),
    el('p', { class: 'r-basis muted', text: `Labour and equipment carried forward at ${money(f.perDay)} per day (${money(f.labourPerDay)} labour, ${money(f.equipmentPerDay)} equipment). Materials still to buy: ${money(f.materialsRemaining)}.` }),
    el('table', { class: 'r-forecast' }, [
      el('thead', {}, el('tr', {}, ['', 'To Date', 'Remaining', 'At Completion'].map((h, i) => el('th', { class: i ? 'm' : '', text: h })))),
      el('tbody', {}, [
        fline('Labour', money(t.labour), money(f.labourRemaining), money(f.labour)),
        fline('Equipment', money(t.equipment), money(f.equipmentRemaining), money(f.equipment)),
        fline('Material and Supplier', money(t.materials), money(f.materialsRemaining), money(f.materials)),
        fline(`Overhead (${t.overheadPercent}%)`, money(t.overhead), money(f.overheadRemaining), money(f.overhead)),
        fline('Total Costs', money(t.totalCosts), money(f.costToComplete), money(f.totalCosts), 'b'),
        fline('Total Contract Value', '', '', money(t.totalContract)),
        fline('Forecast Profit', '', '', money(f.profit), 'b'),
        fline('Forecast Margin', '', '', Calc.formatPercent(f.margin)),
      ]),
    ]),
  ]) : null;
  const dated = [{ key: 'date', label: 'Date(s)' }, { key: 'description', label: 'Description' }, { key: 'amount', label: 'Amount', money: true }];

  r.replaceChildren(...[
    el('h1', { text: j.jobName || 'Untitled job' }),
    el('div', { class: 'r-meta' }, [...details, el('div', { class: 'muted', text: `Report generated ${new Date().toLocaleDateString()}` })]),
    String(j.notes || '').trim() ? el('p', { class: 'r-notes', text: j.notes }) : null,
    el('div', { class: 'r-section r-keep' }, [
      el('h3', { text: 'Total Breakdown' }),
      el('table', { class: 'r-summary' }, el('tbody', {}, [
        line('Labour', money(t.labour)),
        line('Equipment', money(t.equipment)),
        line('Material and Supplier', money(t.materials)),
        line('Total', money(t.subtotal), 'b'),
        line(`Overhead (${t.overheadPercent}%)`, money(t.overhead)),
        line('Total Costs', money(t.totalCosts), 'b'),
        line('Original Contract Value', money(t.originalContract), 'gap'),
        line('Total Contract Value', money(t.totalContract), 'b'),
        line('Contract Profit (costs to date)', money(t.profit), `b gap${t.profit < 0 ? ' neg' : ''}`),
        line('Contract Margin', Calc.formatPercent(t.margin)),
        line(`Draws Submitted (${t.drawCount})`, money(t.draws), 'gap'),
        line('Billed to Date (% of contract)', Calc.formatPercent(t.billedPercent)),
        line('Remaining to Bill', money(t.remainingToBill)),
        line('Profit to Date (draws − costs)', money(t.profitToDate), `b big${t.profitToDate < 0 ? ' neg' : ''}`),
        line('Margin on Draws', Calc.formatPercent(t.marginToDate)),
        ...(f.ready ? [
          line(`Forecast Profit at Completion (${fmtDays(f.daysRemaining)} left)`, money(f.profit), `b big gap${f.profit < 0 ? ' neg' : ''}`),
          line('Forecast Margin', Calc.formatPercent(f.margin)),
        ] : []),
        line('Change Orders (not included)', money(t.changeOrders), 'gap muted'),
      ])),
    ]),
    forecastSection,
    rowsTable('Approved Quotes', 'quotes', [{ key: 'description', label: 'Quote' }, { key: 'notes', label: 'Notes' }, { key: 'amount', label: 'Total', money: true }]),
    rowsTable('Change Orders', 'changeOrders', [{ key: 'description', label: 'Change Order' }, { key: 'notes', label: 'Notes' }, { key: 'amount', label: 'Total', money: true }], '(not included in the contract value)'),
    rowsTable('Progress Draws', 'draws', [{ key: 'drawNumber', label: 'Draw #' }, { key: 'date', label: 'Date Submitted' }, { key: 'description', label: 'Description' }, { key: 'notes', label: 'Notes' }, { key: 'amount', label: 'Amount', money: true }]),
    rowsTable('Labour', 'labour', dated),
    rowsTable('Equipment', 'equipment', dated),
    rowsTable('Material and Supplier Invoices', 'materials', [{ key: 'supplier', label: 'Name' }, { key: 'invoiceNumber', label: 'Invoice #' }, { key: 'notes', label: 'Notes' }, { key: 'amount', label: 'Amount', money: true }]),
    suppliers.length ? el('div', { class: 'r-section r-keep' }, [
      el('h3', { text: 'Company Totals' }),
      el('table', { class: 'r-summary' }, el('tbody', {}, [
        ...suppliers.map(x => line(x.supplier, money(x.total))),
        line('Total', money(t.materials), 'b'),
      ])),
    ]) : null,
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

  window.api.onMenu(run);
  window.api.onRequestClose(async () => {
    if (await confirmIfDirty()) window.api.closeConfirmed();
  });

  setJob(Calc.newJob(), null);
}

init();
