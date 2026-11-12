// Arayüze açılan güvenli köprü. Node erişimi yok; sadece bu fonksiyonlar.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('studio', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
  },
  skill: {
    status: () => ipcRenderer.invoke('skill:status'),
  },
  setup: {
    run: (opts) => ipcRenderer.invoke('setup:run', opts),
    running: () => ipcRenderer.invoke('setup:running'),
    onProgress: on('setup:progress'),
    onDone: on('setup:done'),
  },
  requirements: () => ipcRenderer.invoke('req:check'),
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (name) => ipcRenderer.invoke('projects:create', name),
    open: (dir) => ipcRenderer.invoke('projects:open', dir),
    media: (dir) => ipcRenderer.invoke('media:list', dir),
  },
  chat: {
    send: (dir, text, refs) => ipcRenderer.invoke('chat:send', dir, text, refs),
    answer: (dir, id, value) => ipcRenderer.invoke('chat:answer', dir, id, value),
    interrupt: (dir) => ipcRenderer.invoke('chat:interrupt', dir),
    onEvent: on('session:event'),
  },
  shell: {
    open: (p) => ipcRenderer.invoke('shell:open', p),
    reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
    external: (url) => ipcRenderer.invoke('shell:external', url),
  },
  refs: {
    add: (dir, paths) => ipcRenderer.invoke('refs:add', dir, paths),
    pick: (dir) => ipcRenderer.invoke('refs:pick', dir),
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  mediaUrl: (p) => `film://media/${encodeURIComponent(p)}`,
});
