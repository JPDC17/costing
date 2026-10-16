const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openJob: () => ipcRenderer.invoke('job:open'),
  saveJob: (job, filePath, saveAs) => ipcRenderer.invoke('job:save', { job, filePath, saveAs }),
  exportExcel: job => ipcRenderer.invoke('excel:export', job),
  importExcel: () => ipcRenderer.invoke('excel:import'),
  exportPdf: jobName => ipcRenderer.invoke('pdf:export', jobName),
  reveal: filePath => ipcRenderer.invoke('file:reveal', filePath),
  confirmDiscard: () => ipcRenderer.invoke('dialog:confirmDiscard'),
  closeConfirmed: () => ipcRenderer.send('app:close-confirmed'),
  setTitle: t => ipcRenderer.send('app:set-title', t),
  onMenu: fn => ipcRenderer.on('menu', (_e, cmd) => fn(cmd)),
  onRequestClose: fn => ipcRenderer.on('app:request-close', () => fn()),
});
