/* global Calc */
'use strict';

// Column definitions for each editable table, matching the template's sheets.
const TABLES = {
  quotes: {
    empty: 'No approved quotes yet.',
    cols: [
      { key: 'description', label: 'Approved Quote', type: 'text', placeholder: 'e.g. Quote #1024 – framing' },
      { key: 'amount', label: 'Total', type: 'money' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },
  changeOrders: {
    empty: 'No change orders yet.',
    cols: [
      { key: 'description', label: 'Change Order', type: 'text', placeholder: 'e.g. CO-01 – extra window' },
      { key: 'amount', label: 'Total', type: 'money' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },
  labour: {
    empty: 'No labour entries yet.',
    cols: [
      { key: 'date', label: 'Date(s)', type: 'text', placeholder: 'e.g. Mar 3 – Mar 7' },
      { key: 'description', label: 'Description', type: 'text', placeholder: 'Crew / trade / hours' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
  },
  equipment: {
    empty: 'No equipment entries yet.',
    cols: [
      { key: 'date', label: 'Date(s)', type: 'text', placeholder: 'e.g. Mar 3' },
      { key: 'description', label: 'Description', type: 'text', placeholder: 'Machine / rental' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
  },
  materials: {
    empty: 'No invoices yet.',
    cols: [
      { key: 'supplier', label: 'Name', type: 'text', placeholder: 'Supplier', list: 'suppliers' },
      { key: 'invoiceNumber', label: 'Invoice Number', type: 'text' },
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

function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(el('span', { text: msg }));
  if (action) t.append(el('button', { text: action.label, onclick: action.run }));
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 4000);
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

  const thead = el('thead', {}, el('tr', {}, [
    el('th', { class: 'num', text: '#' }),
    ...def.cols.map(c => el('th', { class: c.type === 'money' ? 'money' : '', text: c.label })),
    el('th', { class: 'act' }),
  ]));

  const tbody = el('tbody');
  rows.forEach((row, i) => tbody.append(renderRow(key, row, i)));
  if (!rows.length) {
    tbody.append(el('tr', { class: 'empty' }, el('td', { colspan: def.cols.length + 2, text: def.empty })));
  }

  const moneyIdx = def.cols.findIndex(c => c.type === 'money');
  const tfoot = el('tfoot', {}, el('tr', {}, [
    el('td'),
    ...def.cols.map((c, i) => {
      if (i === moneyIdx) return el('td', { class: 'money', 'data-total': key });
      if (i === 0) return el('td', { text: 'Total' });
      return el('td');
    }),
    el('td'),
  ]));

  const table = el('table', { class: 'grid' }, [thead, tbody, tfoot]);
  const addBtn = el('button', { class: 'add-row', text: '+ Add row', onclick: () => addRow(key) });
  host.replaceChildren(el('div', { class: 'table-wrap' }, table), addBtn);
  updateTotals();
}

function renderRow(key, row, i) {
  const def = TABLES[key];
  const tr = el('tr', { 'data-id': row.id });
  tr.append(el('td', { class: 'num', text: String(i + 1) }));
  def.cols.forEach((c, ci) => {
    const input = el('input', {
      type: 'text',
      class: c.type === 'money' ? 'money' : '',
      placeholder: c.type === 'money' ? '0.00' : (c.placeholder || ''),
      inputmode: c.type === 'money' ? 'decimal' : undefined,
      list: c.list,
      'aria-label': c.label,
    });
    input.value = c.type === 'money' ? formatInput(row[c.key]) : (row[c.key] || '');
    input.addEventListener('input', () => {
      row[c.key] = input.value;
      markDirty();
      updateTotals();
    });
    if (c.type === 'money') {
      input.addEventListener('focus', () => { input.value = row[c.key] === '' || row[c.key] == null ? '' : String(Calc.num(row[c.key]) || ''); input.select(); });
      input.addEventListener('blur', () => { row[c.key] = Calc.round2(Calc.num(input.value)); input.value = formatInput(row[c.key]); updateTotals(); });
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

function formatInput(v) {
  if (v === '' || v === null || v === undefined) return '';
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
  state.job[key].push(row);
  markDirty();
  renderTable(key);
  focusCell(key, state.job[key].length - 1, focusCol);
}

function deleteRow(key, id) {
  const rows = state.job[key];
  const idx = rows.findIndex(r => r.id === id);
  if (idx < 0) return;
  const [removed] = rows.splice(idx, 1);
  markDirty();
  renderTable(key);
  toast('Row deleted', {
    label: 'Undo',
    run: () => {
      rows.splice(idx, 0, removed);
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

  $('#k-contract').textContent = money(t.totalContract);
  $('#k-costs').textContent = money(t.totalCosts);
  $('#k-profit').textContent = money(t.profit);
  $('#k-profit').classList.toggle('neg', t.profit < 0);
  $('#k-margin').textContent = `${t.margin.toFixed(1)}%`;
  $('#k-margin').classList.toggle('neg', t.margin < 0);

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

  $('#nav-summary').textContent = money(t.profit);
  $('#nav-summary').classList.toggle('neg', t.profit < 0);
  $('#nav-contract').textContent = money(t.totalContract);
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

function renderSuppliers() {
  const list = Calc.supplierTotals(state.job.materials);
  const table = $('#supplierTotals');
  const body = el('tbody');
  if (!list.length) body.append(el('tr', { class: 'empty' }, el('td', { colspan: 2, text: 'Totals by supplier appear here.' })));
  for (const s of list) body.append(el('tr', {}, [el('th', { text: s.supplier }), el('td', { text: money(s.total) })]));
  body.append(el('tr', { class: 'total' }, [el('th', { text: 'Total' }), el('td', { text: money(Calc.sum(state.job.materials)) })]));
  table.replaceChildren(body);

  // Supplier autocomplete for the invoice "Name" column.
  let dl = document.getElementById('suppliers');
  if (!dl) { dl = el('datalist', { id: 'suppliers' }); document.body.append(dl); }
  dl.replaceChildren(...list.filter(s => s.supplier !== '(No supplier)').map(s => el('option', { value: s.supplier })));
}

function renderFields() {
  for (const input of $$('[data-field]')) input.value = state.job[input.dataset.field] || '';
  $('#jobNameTop').value = state.job.jobName || '';
  $('#overheadPercent').value = state.job.overheadPercent;
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
  const rowsTable = (title, key, cols) => {
    const rows = j[key];
    return el('div', { class: 'r-section' }, [
      el('h3', { text: title }),
      el('table', {}, [
        el('thead', {}, el('tr', {}, cols.map(c => el('th', { class: c.money ? 'm' : '', text: c.label })))),
        el('tbody', {}, rows.length
          ? rows.map(x => el('tr', {}, cols.map(c => el('td', { class: c.money ? 'm' : '', text: c.money ? money(x[c.key]) : (x[c.key] || '') }))))
          : [el('tr', {}, el('td', { colspan: cols.length, class: 'muted', text: 'None' }))]),
        el('tfoot', {}, el('tr', {}, cols.map((c, i) => el('td', { class: c.money ? 'm' : '', text: c.money ? money(Calc.sum(rows)) : (i === 0 ? 'Total' : '') })))),
      ]),
    ]);
  };
  const line = (label, value, cls = '') => el('tr', { class: cls }, [el('th', { text: label }), el('td', { class: 'm', text: value })]);

  const details = [
    ['Job number', j.jobNumber], ['Client', j.client], ['Site address', j.address],
  ].filter(([, v]) => v).map(([k, v]) => el('div', {}, [el('b', { text: `${k}: ` }), v]));

  r.replaceChildren(...[
    el('h1', { text: j.jobName || 'Untitled job' }),
    el('div', { class: 'r-meta' }, [...details, el('div', { class: 'muted', text: `Report generated ${new Date().toLocaleDateString()}` })]),
    j.notes ? el('p', { class: 'r-notes', text: j.notes }) : null,
    el('div', { class: 'r-section' }, [
      el('h3', { text: 'Total Breakdown' }),
      el('table', { class: 'r-summary' }, el('tbody', {}, [
        line('Labour', money(t.labour)),
        line('Equipment', money(t.equipment)),
        line('Material and Supplier', money(t.materials)),
        line('Total', money(t.subtotal), 'b'),
        line(`Overhead (${t.overheadPercent}%)`, money(t.overhead)),
        line('Total Costs', money(t.totalCosts), 'b'),
        line('Original Contract Value', money(t.originalContract)),
        line('Change Orders', money(t.changeOrders)),
        line('Total Contract Value', money(t.totalContract), 'b'),
        line('Profit', money(t.profit), 'b big'),
        line('Margin', `${t.margin.toFixed(1)}%`),
      ])),
    ]),
    rowsTable('Approved Quotes', 'quotes', [{ key: 'description', label: 'Quote' }, { key: 'notes', label: 'Notes' }, { key: 'amount', label: 'Total', money: true }]),
    rowsTable('Change Orders', 'changeOrders', [{ key: 'description', label: 'Change Order' }, { key: 'notes', label: 'Notes' }, { key: 'amount', label: 'Total', money: true }]),
    rowsTable('Labour', 'labour', [{ key: 'date', label: 'Date(s)' }, { key: 'description', label: 'Description' }, { key: 'amount', label: 'Amount', money: true }]),
    rowsTable('Equipment', 'equipment', [{ key: 'date', label: 'Date(s)' }, { key: 'description', label: 'Description' }, { key: 'amount', label: 'Amount', money: true }]),
    rowsTable('Material and Supplier Invoices', 'materials', [{ key: 'supplier', label: 'Name' }, { key: 'invoiceNumber', label: 'Invoice #' }, { key: 'notes', label: 'Notes' }, { key: 'amount', label: 'Amount', money: true }]),
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
  for (const key of Object.keys(TABLES)) for (const r of j[key]) r.amount = Calc.round2(Calc.num(r.amount));
  j.overheadPercent = Calc.num(j.overheadPercent);
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
    toast('Job saved');
    return true;
  } catch (err) {
    toast(`Could not save: ${err.message}`);
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
    } catch (err) { toast(`Could not open file: ${err.message}`); }
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
    } catch (err) { toast(`Could not import: ${err.message}`); }
  },
  async exportExcel() {
    try {
      const res = await window.api.exportExcel(serialize());
      if (res) toast('Exported to Excel', { label: 'Show file', run: () => window.api.reveal(res.filePath) });
    } catch (err) { toast(`Could not export: ${err.message}`); }
  },
  async exportPdf() {
    buildReport();
    try {
      const res = await window.api.exportPdf(state.job.jobName);
      if (res) toast('Report saved as PDF', { label: 'Show file', run: () => window.api.reveal(res.filePath) });
    } catch (err) { toast(`Could not export PDF: ${err.message}`); }
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

  window.api.onMenu(run);
  window.api.onRequestClose(async () => {
    if (await confirmIfDirty()) window.api.closeConfirmed();
  });

  setJob(Calc.newJob(), null);
}

init();
