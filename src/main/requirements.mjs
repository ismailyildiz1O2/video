// cinecode'un ihtiyaç duyduğu araçları denetler: Node 22+, Python 3.9+, ffmpeg, Chrome.
// Eksik olanı skill'in kendisi de kullanıcıya sorarak kurmayı teklif eder;
// burada sadece durumu gösteriyoruz.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toolBinDirs, canAutoInstall, installTool } from './tools.mjs';

/** GUI'den açılan uygulamalarda (özellikle macOS) PATH çok kısa olur; yaygın dizinleri ekle.
 *  Uygulamanın kendi kurduğu araçlar (userData/tools) en başa konur. */
export function augmentedPath() {
  const extra =
    process.platform === 'win32'
      ? []
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', path.join(os.homedir(), '.local', 'bin')];
  const current = process.env.PATH || process.env.Path || '';
  const parts = [...toolBinDirs(), ...current.split(path.delimiter).filter(Boolean)];
  for (const p of extra) if (!parts.includes(p)) parts.push(p);
  return [...new Set(parts)].join(path.delimiter);
}

/** process.env kopyası, PATH'i genişletilmiş. Windows'ta "Path" ile "PATH" çakışmasın diye eskisi silinir. */
export function envWithPath(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k];
  return { ...env, PATH: augmentedPath(), ...extra };
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true, env: envWithPath() }, (err, stdout, stderr) => {
      resolve(err ? null : `${stdout}${stderr}`.trim());
    });
  });
}

async function firstOk(cands, args) {
  for (const c of cands) {
    const out = await run(c, args);
    if (out) return { cmd: c, out };
  }
  return null;
}

function chromePath() {
  const c = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    win32: [
      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium'],
  }[process.platform] || [];
  return c.find((p) => p && fs.existsSync(p)) || null;
}

function versionAtLeast(text, re, major, minor = 0) {
  const m = text && text.match(re);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2] || 0)];
  return a > major || (a === major && b >= minor);
}

export async function checkRequirements() {
  const node = await firstOk(['node'], ['--version']);
  const py = await firstOk(process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'], ['--version']);
  const ff = await firstOk(['ffmpeg'], ['-version']);
  const chrome = chromePath();
  const list = [
    {
      id: 'node',
      label: 'Node.js 22+',
      ok: versionAtLeast(node?.out, /v(\d+)\.(\d+)/, 22),
      detail: node?.out || 'bulunamadı',
      help: 'https://nodejs.org',
    },
    {
      id: 'python',
      label: 'Python 3.9+',
      ok: versionAtLeast(py?.out, /Python (\d+)\.(\d+)/, 3, 9),
      detail: py?.out || 'bulunamadı',
      help: 'https://www.python.org/downloads/',
    },
    {
      id: 'ffmpeg',
      label: 'ffmpeg',
      ok: Boolean(ff),
      detail: ff ? ff.out.split('\n')[0] : 'bulunamadı',
      help: 'https://ffmpeg.org/download.html',
    },
    {
      id: 'chrome',
      label: 'Chrome / Chromium / Edge',
      ok: Boolean(chrome),
      detail: chrome || 'bulunamadı',
      help: 'https://www.google.com/chrome/',
    },
  ];
  return list.map((r) => ({ ...r, auto: canAutoInstall(r.id) }));
}

/** Eksik olup otomatik kurulabilen her şeyi kurar; sonunda güncel durumu döner. */
export async function installMissing(onProgress = () => {}) {
  const errors = [];
  for (const r of await checkRequirements()) {
    if (r.ok || !r.auto) continue;
    try {
      await installTool(r.id, onProgress);
    } catch (err) {
      errors.push(`${r.label}: ${err.message}`);
      onProgress(`${r.label} kurulamadı: ${err.message}`);
    }
  }
  const after = await checkRequirements();
  return { requirements: after, errors };
}
