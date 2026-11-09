'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('bar', {
  // opts: { prior, files, resumeAt, fresh } (see main.js)
  ask: (prompt, images, opts) => ipcRenderer.send('ask', { prompt, images, ...(opts || {}) }),
  saveChat: (messages) => ipcRenderer.send('save-chat', messages),
  listChats: () => ipcRenderer.invoke('list-chats'),
  openChat: (id) => ipcRenderer.invoke('open-chat', id),
  deleteChat: (id) => ipcRenderer.invoke('delete-chat', id),
  copy: (text) => ipcRenderer.send('copy', text),
  continueInCode: () => ipcRenderer.send('continue-code'),
  hasSession: () => ipcRenderer.invoke('has-session'),
  setOption: (key, value) => ipcRenderer.send('set-option', key, value),
  onConfig: (cb) => on('config', cb),
  stop: () => ipcRenderer.send('stop'),
  newChat: () => ipcRenderer.send('new-chat'),
  hide: () => ipcRenderer.send('hide'),
  pin: (v) => ipcRenderer.send('pin', v),
  resize: (h) => ipcRenderer.send('resize', h),
  handoff: (history) => ipcRenderer.send('handoff', history),
  setMode: (m) => ipcRenderer.send('mode', m),
  onDelta: (cb) => on('delta', cb),
  onDone: (cb) => on('done', cb),
  onError: (cb) => on('error', cb),
  onReset: (cb) => on('reset', cb),
  onFocus: (cb) => on('focus-input', cb),
  onNotice: (cb) => on('notice', cb),
  onStatus: (cb) => on('status', cb),
  onThinking: (cb) => on('thinking', cb),
  onUsage: (cb) => on('usage', cb),
  onAttach: (cb) => on('attach', cb),
  onEngine: (cb) => on('engine', cb),
  onWebState: (cb) => on('web-state', cb),
  setEngine: (e) => ipcRenderer.invoke('set-engine', e),
  webAsk: (text) => ipcRenderer.send('web-ask', text),
  webOpen: (where) => ipcRenderer.send('web-open', where),
  webOpenApp: () => ipcRenderer.send('web-open-app'),
  screenshot: () => ipcRenderer.send('screenshot'),
});
