const { app, BrowserWindow, Menu, dialog, ipcMain, shell, screen, net } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');
const Updater = require('./updater');
const pkg = require('../package.json');
// The Excel library is only loaded the first time a workbook is exported or imported,
// so it doesn't slow down starting the app.
const excel = () => require('./excel');
const Calc = require('./calc');
const Company = require('./company');

const JOB_FILTERS = [{ name: 'Job Costing File', extensions: ['jobcost'] }, { name: 'All Files', extensions: ['*'] }];
const XLSX_FILTERS = [{ name: 'Excel Workbook', extensions: ['xlsx'] }];

const APP_BACKGROUND = '#f4f4f3';

let win;
let allowClose = false;

// Turn file system errors into something a person can act on.
function friendly(err, what) {
  if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
    return new Error(`The file is open in another program or is read-only. Close it (for example in Excel) and try ${what} again.`);
  }
  if (err && err.code === 'ENOENT') return new Error(`That folder doesn't exist. Choose another location and try ${what} again.`);
  if (err && err.code === 'ENOSPC') return new Error('The disk is full.');
  return err;
}

// Write to a temporary file first, then swap it in, so a crash or power cut
// part-way through a save can never leave a half-written file.
async function writeFileSafely(target, data) {
  const tmp = `${target}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    // On Windows, antivirus or backup software can lock a file for a moment; retry briefly.
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, target);
        break;
      } catch (err) {
        if (attempt >= 9 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
      }
    }
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

// A file name Windows will accept: no reserved characters, no trailing dots or
// spaces, and not a reserved device name like CON or PRN.
function safeName(name, fallback) {
  let base = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').replace(/[. ]+$/, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base += ' job';
  return base.slice(0, 120) || fallback;
}

function createWindow() {
  // Fit the window to the screen, so small or scaled laptop screens (e.g. 1366x768
  // at 125%) don't get a window taller than the screen.
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1280, area.width);
  const height = Math.min(860, area.height);
  win = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(900, area.width),
    minHeight: Math.min(560, area.height),
    title: 'Job Costing',
    backgroundColor: APP_BACKGROUND,
    icon: path.join(__dirname, 'renderer', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (area.width < 1100 || area.height < 700) win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Never navigate away from the app; open external links in the browser.
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // If the page crashes it can't answer the close request below, so don't block closing.
  win.webContents.on('render-process-gone', () => { allowClose = true; });

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
      label: 'Help',
      submenu: [
        { label: 'Check for Updates…', click: () => send('checkUpdates') },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
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
  let data;
  try {
    data = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error('This isn\'t a Job Costing file, or the file is damaged.');
    throw err;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('This isn\'t a Job Costing file.');
  const job = Calc.normalizeJob(data);
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
  try {
    await writeFileSafely(target, JSON.stringify(job, null, 2));
  } catch (err) {
    throw friendly(err, 'saving');
  }
  app.addRecentDocument(target);
  return { filePath: target };
});

// ---------- Company details (saved once per computer) ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const LOGO_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp' };
const MAX_LOGO_FILE = 15 * 1024 * 1024;

async function readSettings() {
  try {
    const data = JSON.parse(await fs.readFile(settingsFile(), 'utf8'));
    return { company: Company.normalizeCompany(data && data.company) };
  } catch {
    return { company: Company.emptyCompany() };
  }
}

ipcMain.handle('settings:get', () => readSettings());

ipcMain.handle('settings:saveCompany', async (_e, company) => {
  const clean = Company.normalizeCompany(company);
  try {
    await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
    await writeFileSafely(settingsFile(), JSON.stringify({ company: clean }, null, 2));
  } catch (err) {
    throw friendly(err, 'saving');
  }
  return clean;
});

// Let the person pick an image; the window resizes it and turns it into a PNG.
ipcMain.handle('settings:pickLogo', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose your company logo',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: Object.keys(LOGO_TYPES).map(e => e.slice(1)) }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const file = res.filePaths[0];
  const type = LOGO_TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error('Choose a PNG, JPG, GIF, WebP, SVG or BMP image.');
  const stat = await fs.stat(file);
  if (stat.size > MAX_LOGO_FILE) throw new Error('That image is too large (over 15 MB). Please use a smaller file.');
  const data = await fs.readFile(file);
  return { dataUrl: `data:${type};base64,${data.toString('base64')}`, name: path.basename(file) };
});

ipcMain.handle('excel:export', async (_e, job) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: safeName(job.jobName, 'Job') + ' - Costing.xlsx',
    filters: XLSX_FILTERS,
  });
  if (res.canceled || !res.filePath) return null;
  try {
    await excel().exportWorkbook(job, res.filePath, (await readSettings()).company);
  } catch (err) {
    throw friendly(err, 'exporting');
  }
  return { filePath: res.filePath };
});

ipcMain.handle('excel:import', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: XLSX_FILTERS });
  if (res.canceled || !res.filePaths.length) return null;
  return { job: await excel().importWorkbook(res.filePaths[0]), filePath: res.filePaths[0] };
});

ipcMain.handle('pdf:export', async (_e, jobName) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: safeName(jobName, 'Job') + ' - Cost Report.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return null;
  // Page size, margins and the footer (job name, page numbers) come from the report's
  // @page CSS, so the footer uses the app's own font.
  // Keep the page margins white even if a report ever uses shading.
  win.setBackgroundColor('#ffffff');
  let data;
  try {
    data = await win.webContents.printToPDF({
      printBackground: false,
      preferCSSPageSize: true,
    });
  } finally {
    win.setBackgroundColor(APP_BACKGROUND);
  }
  try {
    await fs.writeFile(res.filePath, data);
  } catch (err) {
    throw friendly(err, 'exporting');
  }
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

// ---------- Updates ----------
// For testing, JOB_COSTING_UPDATE_MANIFEST can point at a local test server.
const UPDATE_MANIFEST = process.env.JOB_COSTING_UPDATE_MANIFEST || (pkg.updates && pkg.updates.manifest);
const EXTRA_TRUST = process.env.JOB_COSTING_UPDATE_MANIFEST ? ['http://127.0.0.1:'] : [];
let pendingUpdate = null;
let installing = false;

// Remove update downloads left in the temp folder by earlier updates (over a day old).
async function cleanOldUpdates() {
  try {
    const tmp = app.getPath('temp');
    for (const name of await fs.readdir(tmp)) {
      if (!name.startsWith('JobCosting-update-')) continue;
      const dir = path.join(tmp, name);
      const st = await fs.stat(dir);
      if (st.isDirectory() && Date.now() - st.mtimeMs > 24 * 3600 * 1000) await fs.rm(dir, { recursive: true, force: true });
    }
  } catch { /* not important */ }
}

async function fetchManifest() {
  if (!UPDATE_MANIFEST) throw new Error('Updates are not set up for this copy of the app.');
  const res = await net.fetch(`${UPDATE_MANIFEST}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`The update server answered ${res.status}.`);
  return Updater.validateManifest(await res.json(), EXTRA_TRUST);
}

ipcMain.handle('update:version', () => app.getVersion());

async function checkForUpdate() {
  const m = await fetchManifest();
  const available = Updater.compareVersions(m.version, app.getVersion()) > 0;
  pendingUpdate = available ? m : null;
  return { m, available };
}

ipcMain.handle('update:check', async () => {
  try {
    const { m } = await checkForUpdate();
    const available = !!pendingUpdate;
    return { current: app.getVersion(), latest: m.version, available, notes: m.notes, size: m.size };
  } catch (err) {
    const offline = /fetch|network|net::|ERR_|ENOTFOUND|ECONN|abort|timed? ?out/i.test(String(err && (err.message || err)));
    throw new Error(offline ? 'Could not reach the update server. Check your internet connection and try again.' : err.message);
  }
});

// Download the new exe, check it, then swap it in and restart (portable exe only).
ipcMain.handle('update:install', async () => {
  const m = pendingUpdate;
  if (!m) throw new Error('No update is waiting. Check for updates first.');
  if (installing) throw new Error('The update is already downloading.');
  installing = true;
  try {
    return await installUpdate(m);
  } finally {
    installing = false;
  }
});

async function installUpdate(m) {
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!portableExe) {
    // Not running as the portable exe (e.g. from source): just open the download.
    await shell.openExternal(m.url);
    return { manual: true };
  }
  const res = await net.fetch(m.url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`);
  const hash = crypto.createHash('sha256');
  const chunks = [];
  let received = 0, lastSent = 0;
  for await (const chunk of res.body) {
    const buf = Buffer.from(chunk);
    chunks.push(buf); hash.update(buf); received += buf.length;
    if (received > m.size) throw new Error('The download is larger than expected, so it was not used.');
    if (win && Date.now() - lastSent > 150) { lastSent = Date.now(); win.webContents.send('update:progress', { received, total: m.size }); }
  }
  if (received !== m.size) throw new Error('The download was incomplete. Please try again.');
  if (hash.digest('hex') !== m.sha256) throw new Error('The download did not match its checksum, so it was not used. If an update was published in the last few minutes, GitHub may still be updating its copy; please try again shortly.');
  if (win) win.webContents.send('update:progress', { received, total: m.size });

  const dir = await fs.mkdtemp(path.join(app.getPath('temp'), 'JobCosting-update-'));
  const newExe = path.join(dir, `JobCosting-Portable-${m.version}.exe`);
  await fs.writeFile(newExe, Buffer.concat(chunks));
  try {
    // Windows PowerShell rebuilds its own module path; one inherited from PowerShell 7
    // (if the app was started from a PowerShell 7 window) can stop it loading its commands.
    const env = { ...process.env };
    delete env.PSModulePath;
    // A PowerShell started as a detached, console-less process can exit at once (it
    // did on Windows 10/11 in testing). So start a short-lived PowerShell normally and
    // wait for it: it launches the swap as its own hidden process (which carries on
    // after the app closes) and exits with 0 once that has started.
    const launcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Updater.launchCommand(newExe, portableExe)], { stdio: 'ignore', windowsHide: true, env });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { launcher.kill(); reject(new Error('timed out')); }, 30000);
      launcher.once('error', err => { clearTimeout(timer); reject(err); });
      launcher.once('exit', c => { clearTimeout(timer); resolve(c); });
    });
    if (code !== 0) throw new Error(`launcher exited with ${code}`);
  } catch {
    // Couldn't start the helper: leave the new version where it is and show it.
    shell.showItemInFolder(newExe);
    return { manual: true, file: newExe };
  }
  allowClose = true;
  setTimeout(() => app.quit(), 400);
  return { restarting: true, version: m.version };
}

// Test switches for the end-to-end update test on Windows (see scripts/e2e-update-windows.ps1).
// They do nothing unless these environment variables are set.
async function e2eHooks() {
  const marker = process.env.JOB_COSTING_E2E_MARKER;
  const note = async text => { if (marker) await fs.appendFile(marker, `${new Date().toISOString()} ${app.getVersion()} ${text}\n`).catch(() => {}); };
  await note(`started (exe ${process.env.PORTABLE_EXECUTABLE_FILE || '-'})`);
  if (win) {
    const ready = () => note('window ready');
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', ready); else ready();
  }
  if (process.env.JOB_COSTING_E2E_AUTOUPDATE !== '1') return;
  try {
    const { m, available } = await checkForUpdate();
    await note(`checked: latest ${m.version}, update ${available ? 'available' : 'not needed'}`);
    if (available) await note(`install: ${JSON.stringify(await installUpdate(m))}`);
  } catch (err) {
    await note(`update error: ${err.message}`);
  }
}

app.whenReady().then(() => {
  cleanOldUpdates();
  buildMenu();
  createWindow();
  if (process.env.JOB_COSTING_E2E_MARKER) e2eHooks();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { allowClose = false; createWindow(); } });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
