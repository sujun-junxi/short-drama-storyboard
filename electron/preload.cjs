/* eslint-disable no-undef */
// 沙箱化的 preload 只能使用 CommonJS + 受限的 electron 模块，
// 因此这里用 .cjs 而非 ESM。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
})
