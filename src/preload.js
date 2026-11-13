const { contextBridge, ipcRenderer } = require('electron');

// The saved theme, passed by the main process so it's known before the page paints.
const themeArg = process.argv.find(a => a.startsWith('--job-costing-theme='));

contextBridge.exposeInMainWorld('api', {
  initialTheme: themeArg && themeArg.endsWith('=dark') ? 'dark' : 'light',
  saveTheme: theme => ipcRenderer.invoke('settings:saveTheme', theme),
  openJob: () => ipcRenderer.invoke('job:open'),
  saveJob: (job, filePath, saveAs) => ipcRenderer.invoke('job:save', { job, filePath, saveAs }),
  exportExcel: job => ipcRenderer.invoke('excel:export', job),
  importExcel: () => ipcRenderer.invoke('excel:import'),
  exportPdf: jobName => ipcRenderer.invoke('pdf:export', jobName),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveCompany: company => ipcRenderer.invoke('settings:saveCompany', company),
  pickLogo: () => ipcRenderer.invoke('settings:pickLogo'),
  appVersion: () => ipcRenderer.invoke('update:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: fn => ipcRenderer.on('update:progress', (_e, p) => fn(p)),
  reveal: filePath => ipcRenderer.invoke('file:reveal', filePath),
  confirmDiscard: () => ipcRenderer.invoke('dialog:confirmDiscard'),
  closeConfirmed: () => ipcRenderer.send('app:close-confirmed'),
  setTitle: t => ipcRenderer.send('app:set-title', t),
  onMenu: fn => ipcRenderer.on('menu', (_e, cmd) => fn(cmd)),
  onRequestClose: fn => ipcRenderer.on('app:request-close', () => fn()),
});
