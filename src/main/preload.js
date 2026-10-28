'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);
const on = (name) => (cb) => {
  const fn = (_e, ...args) => cb(...args);
  ipcRenderer.on(name, fn);
  return () => ipcRenderer.removeListener(name, fn);
};

contextBridge.exposeInMainWorld('iv', {
  initialFile: call('initial-file'),
  info: call('info'),
  openDialog: call('open-dialog'),
  stat: call('stat'),
  listFolder: call('list-folder'),
  decode: call('decode'),
  historyGet: call('history-get'),
  historyAdd: call('history-add'),
  historyRemove: call('history-remove'),
  historyClear: call('history-clear'),
  settingsGet: call('settings-get'),
  settingsSet: call('settings-set'),
  defaultStatus: call('default-status'),
  makeDefault: call('make-default'),
  showInFolder: call('show-in-folder'),
  trash: call('trash'),
  copyImage: call('copy-image'),
  copyText: call('copy-text'),
  fullscreen: call('fullscreen'),
  setTitle: call('set-title'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onOpenFile: on('open-file'),
  onFullscreen: on('fullscreen'),
  onFocus: on('focus'),
});
