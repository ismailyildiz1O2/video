// Cinecode Studio — Electron ana süreci.
import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSettings, publicSettings, updateSettings, getApiKey } from './settings.mjs';
import { ensureSkill, skillStatus } from './skill.mjs';
import { checkRequirements, installMissing } from './requirements.mjs';
import { listProjects, createProject, listMedia, readChat, readMeta, isInside } from './projects.mjs';
import { FilmSession } from './session.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessions = new Map(); // proje dizini -> FilmSession
let win = null;

// film://media/<url-encoded mutlak yol> — sadece projeler klasöründeki dosyalar sunulur.
protocol.registerSchemesAsPrivileged([
  { scheme: 'film', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function projectsRoot() {
  return loadSettings().projectsDir;
}

function assertProject(dir) {
  if (typeof dir !== 'string' || !isInside(projectsRoot(), dir) || path.resolve(dir) === path.resolve(projectsRoot())) {
    throw new Error('Geçersiz proje klasörü.');
  }
  return path.resolve(dir);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    title: 'Cinecode Studio',
    backgroundColor: '#111113',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Dış bağlantılar sistem tarayıcısında açılsın.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
}

function getSession(dir) {
  let s = sessions.get(dir);
  if (s) return s;
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Önce Ayarlar\'dan Anthropic API anahtarını girin.');
  const st = loadSettings();
  s = new FilmSession({
    dir,
    apiKey,
    model: st.model,
    effort: st.effort,
    emit: (ev) => send('session:event', { dir, ...ev }),
  });
  sessions.set(dir, s);
  return s;
}

function resetSessions() {
  for (const s of sessions.values()) if (!s.busy) s.close();
  for (const [d, s] of sessions) if (s.closed) sessions.delete(d);
}

// Kurulum: cinecode kitini ve eksik araçları (Python, ffmpeg, Node.js) kullanıcıya sormadan kurar.
let setupPromise = null;
function runSetup({ forceSkill = false } = {}) {
  if (setupPromise) return setupPromise;
  const progress = (m) => send('setup:progress', m);
  setupPromise = (async () => {
    const errors = [];
    try {
      const st = skillStatus();
      if (!st.installed || forceSkill || loadSettings().autoUpdateSkill) await ensureSkill({ force: forceSkill, onProgress: progress });
    } catch (err) {
      errors.push(`cinecode: ${err.message}`);
      progress(`cinecode kurulamadı: ${err.message}`);
    }
    const r = await installMissing(progress);
    errors.push(...r.errors);
    const result = { skill: skillStatus(), requirements: r.requirements, errors };
    progress(errors.length ? 'Kurulum tamamlanamadı, ayrıntı Ayarlar\'da.' : 'Her şey hazır.');
    send('setup:done', result);
    return result;
  })().finally(() => (setupPromise = null));
  return setupPromise;
}

function registerIpc() {
  ipcMain.handle('setup:run', (_e, opts) => runSetup(opts || {}));
  ipcMain.handle('setup:running', () => Boolean(setupPromise));
  ipcMain.handle('settings:get', () => publicSettings());
  ipcMain.handle('settings:set', (_e, patch) => {
    const r = updateSettings(patch || {});
    resetSessions(); // yeni model/anahtar sonraki mesajda geçerli olsun
    return r;
  });
  ipcMain.handle('dialog:pickDir', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('skill:status', () => skillStatus());
  ipcMain.handle('req:check', () => checkRequirements());

  ipcMain.handle('projects:list', () => listProjects(projectsRoot()));
  ipcMain.handle('projects:create', (_e, name) => createProject(projectsRoot(), String(name || 'Yeni film')));
  ipcMain.handle('projects:open', (_e, dir) => {
    dir = assertProject(dir);
    const s = sessions.get(dir);
    return { dir, meta: readMeta(dir), history: readChat(dir), busy: Boolean(s?.busy) };
  });
  ipcMain.handle('media:list', (_e, dir) => listMedia(assertProject(dir)));

  ipcMain.handle('chat:send', (_e, dir, text) => {
    dir = assertProject(dir);
    if (!String(text || '').trim()) return;
    getSession(dir).send(String(text));
  });
  ipcMain.handle('chat:answer', (_e, dir, id, value) => sessions.get(assertProject(dir))?.answer(id, value));
  ipcMain.handle('chat:interrupt', (_e, dir) => sessions.get(assertProject(dir))?.interrupt());

  ipcMain.handle('shell:open', (_e, p) => {
    if (!isInside(projectsRoot(), p)) throw new Error('Geçersiz yol.');
    return shell.openPath(p);
  });
  ipcMain.handle('shell:reveal', (_e, p) => {
    if (!isInside(projectsRoot(), p)) throw new Error('Geçersiz yol.');
    shell.showItemInFolder(p);
  });
  ipcMain.handle('shell:external', (_e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  protocol.handle('film', (req) => {
    const u = new URL(req.url);
    const p = decodeURIComponent(u.pathname.slice(1));
    if (u.host !== 'media' || !isInside(projectsRoot(), p) || !fs.existsSync(p)) {
      return new Response('Bulunamadı', { status: 404 });
    }
    return net.fetch(pathToFileURL(p).toString(), { headers: req.headers });
  });
  registerIpc();
  createWindow();
  // Pencere yüklenince her şeyi arka planda hazırla: cinecode + eksik araçlar.
  win.webContents.once('did-finish-load', () => runSetup());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const s of sessions.values()) s.close();
  sessions.clear();
  if (process.platform !== 'darwin') app.quit();
});
