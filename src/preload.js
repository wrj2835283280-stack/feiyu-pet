'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  ready: () => ipcRenderer.invoke('pet:ready'),
  getData: () => ipcRenderer.invoke('pet:get-data'),
  getConfig: () => ipcRenderer.invoke('pet:get-config'),
  setConfig: (patch) => ipcRenderer.invoke('pet:set-config', patch),
  resetConfig: () => ipcRenderer.invoke('pet:reset-config'),
  pickFolder: () => ipcRenderer.invoke('pet:pick-folder'),
  openPath: (p) => ipcRenderer.invoke('pet:open-path', p),
  openDataDir: () => ipcRenderer.invoke('pet:open-data-dir'),
  setIgnore: (flag) => ipcRenderer.send('pet:set-ignore', !!flag),
  setHitmap: (payload) => ipcRenderer.send('pet:hitmap', payload),
  dragStart: (petRect) => ipcRenderer.send('pet:drag-start', petRect || null),
  petRect: (rect) => ipcRenderer.send('pet:pet-rect', rect || null),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  hide: () => ipcRenderer.send('pet:hide'),
  show: () => ipcRenderer.send('pet:show'),
  resetPos: () => ipcRenderer.send('pet:reset-pos'),
  settingsOpen: () => ipcRenderer.send('pet:settings-open'),
  settingsClose: () => ipcRenderer.send('pet:settings-close'),
  quit: () => ipcRenderer.send('pet:quit'),
  log: (...args) => ipcRenderer.send('pet:log', ...args),
  onData: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('pet:data', fn);
    return () => ipcRenderer.removeListener('pet:data', fn);
  },
  onConfig: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('pet:config', fn);
    return () => ipcRenderer.removeListener('pet:config', fn);
  },
  onAction: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('ui:action', fn);
    return () => ipcRenderer.removeListener('ui:action', fn);
  }
});
