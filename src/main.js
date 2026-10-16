const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { exportWorkbook, importWorkbook } = require('./excel');
const Calc = require('./calc');

const JOB_FILTERS = [{ name: 'Job Costing File', extensions: ['jobcost'] }, { name: 'All Files', extensions: ['*'] }];
const XLSX_FILTERS = [{ name: 'Excel Workbook', extensions: ['xlsx'] }];

let win;
let allowClose = false;

function safeName(name, fallback) {
  const base = String(name || '').replace(/[\\/:*?"<>|]+/g, '').trim();
  return base || fallback;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Job Costing',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Never navigate away from the app; open external links in the browser.
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Ask the renderer whether there are unsaved changes before closing.
  win.on('close', e => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('app:request-close');
  });
}

function send(channel) {
  if (win) win.webContents.send('menu', channel);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Job', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open Job…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveAs') },
        { type: 'separator' },
        { label: 'Import from Excel…', accelerator: 'CmdOrCtrl+I', click: () => send('importExcel') },
        { label: 'Export to Excel…', accelerator: 'CmdOrCtrl+E', click: () => send('exportExcel') },
        { label: 'Export Report as PDF…', accelerator: 'CmdOrCtrl+P', click: () => send('exportPdf') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------

ipcMain.handle('job:open', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: JOB_FILTERS });
  if (res.canceled || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  const job = Calc.normalizeJob(JSON.parse(await fs.readFile(filePath, 'utf8')));
  app.addRecentDocument(filePath);
  return { filePath, job };
});

ipcMain.handle('job:save', async (_e, { job, filePath, saveAs }) => {
  let target = filePath;
  if (!target || saveAs) {
    const res = await dialog.showSaveDialog(win, {
      defaultPath: safeName(job.jobName, 'Untitled Job') + '.jobcost',
      filters: JOB_FILTERS,
    });
    if (res.canceled || !res.filePath) return null;
    target = res.filePath;
  }
  await fs.writeFile(target, JSON.stringify(job, null, 2), 'utf8');
  app.addRecentDocument(target);
  return { filePath: target };
});

ipcMain.handle('excel:export', async (_e, job) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: safeName(job.jobName, 'Job') + ' - Costing.xlsx',
    filters: XLSX_FILTERS,
  });
  if (res.canceled || !res.filePath) return null;
  await exportWorkbook(job, res.filePath);
  return { filePath: res.filePath };
});

ipcMain.handle('excel:import', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: XLSX_FILTERS });
  if (res.canceled || !res.filePaths.length) return null;
  return { job: await importWorkbook(res.filePaths[0]), filePath: res.filePaths[0] };
});

ipcMain.handle('pdf:export', async (_e, jobName) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: safeName(jobName, 'Job') + ' - Cost Report.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const data = await win.webContents.printToPDF({ printBackground: false, pageSize: 'Letter', margins: { marginType: 'default' } });
  await fs.writeFile(res.filePath, data);
  return { filePath: res.filePath };
});

ipcMain.handle('file:reveal', (_e, filePath) => { shell.showItemInFolder(filePath); });

ipcMain.handle('dialog:confirmDiscard', async () => {
  const res = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: 'Do you want to save changes to this job?',
    detail: 'Your changes will be lost if you don’t save them.',
  });
  return ['save', 'discard', 'cancel'][res.response];
});

ipcMain.on('app:close-confirmed', () => {
  allowClose = true;
  if (win) win.close();
});

ipcMain.on('app:set-title', (_e, title) => { if (win) win.setTitle(title); });

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { allowClose = false; createWindow(); } });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
