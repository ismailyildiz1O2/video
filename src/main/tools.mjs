// Eksik araçları (Python, ffmpeg, Node.js) kullanıcıya hiçbir şey sormadan
// uygulamanın kendi klasörüne (userData/tools) taşınabilir sürüm olarak kurar.
// Sistem geneline bir şey kurulmaz; bu araçlar sadece uygulamanın ajanına PATH ile verilir.
import { app, net } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';

const PY = { tag: '20241206', version: '3.12.8' };
const NODE = 'v22.23.4';

export function toolsDir() {
  return path.join(app.getPath('userData'), 'tools');
}

function pyUrl(triple) {
  const name = `cpython-${PY.version}+${PY.tag}-${triple}-install_only.tar.gz`;
  return `https://github.com/astral-sh/python-build-standalone/releases/download/${PY.tag}/${encodeURIComponent(name)}`;
}

/** Bu platformda otomatik kurulabilen araçlar. */
function specs() {
  const { platform: p, arch: a } = process;
  const s = {};
  if (p === 'win32') {
    s.python = { url: pyUrl(a === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'), kind: 'tgz', label: 'Python' };
    s.ffmpeg = {
      url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${a === 'arm64' ? 'winarm64' : 'win64'}-gpl.zip`,
      kind: 'zip',
      label: 'ffmpeg',
    };
    s.node = { url: `https://nodejs.org/dist/${NODE}/node-${NODE}-win-${a === 'arm64' ? 'arm64' : 'x64'}.zip`, kind: 'zip', label: 'Node.js' };
  } else if (p === 'darwin') {
    s.python = { url: pyUrl(a === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'), kind: 'tgz', label: 'Python' };
    s.node = { url: `https://nodejs.org/dist/${NODE}/node-${NODE}-darwin-${a === 'arm64' ? 'arm64' : 'x64'}.tar.gz`, kind: 'tgz', label: 'Node.js' };
    // macOS için güvenilir bir resmi ffmpeg ikilisi yok; gerekirse ajan Homebrew ile kurmayı teklif eder.
  } else if (p === 'linux' && a === 'x64') {
    s.python = { url: pyUrl('x86_64-unknown-linux-gnu'), kind: 'tgz', label: 'Python' };
    s.ffmpeg = { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz', kind: 'txz', label: 'ffmpeg' };
    s.node = { url: `https://nodejs.org/dist/${NODE}/node-${NODE}-linux-x64.tar.gz`, kind: 'tgz', label: 'Node.js' };
  }
  return s;
}

export function canAutoInstall(id) {
  return Boolean(specs()[id]);
}

/** Kurulu araçların çalıştırılabilir dosyalarının bulunduğu dizinler (PATH'in başına eklenir). */
export function toolBinDirs() {
  const root = toolsDir();
  const dirs = [];
  const win = process.platform === 'win32';
  for (const id of ['python', 'ffmpeg', 'node']) {
    const base = path.join(root, id);
    if (!fs.existsSync(base)) continue;
    const exe = { python: win ? 'python.exe' : 'python3', ffmpeg: win ? 'ffmpeg.exe' : 'ffmpeg', node: win ? 'node.exe' : 'node' }[id];
    const found = findFile(base, exe, 4);
    if (found) dirs.push(path.dirname(found));
  }
  return dirs;
}

function findFile(dir, name, depth) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) if ((e.isFile() || e.isSymbolicLink()) && e.name.toLowerCase() === name.toLowerCase()) return path.join(dir, e.name);
  // Python'da Lib/ gibi büyük alt dizinlere girmeden önce olası bin dizinlerine bak.
  const sorted = entries.filter((e) => e.isDirectory()).sort((x, y) => (y.name === 'bin') - (x.name === 'bin'));
  for (const e of sorted) {
    if (['Lib', 'lib', 'include', 'share', 'doc', 'node_modules', 'tcl'].includes(e.name)) continue;
    const r = findFile(path.join(dir, e.name), name, depth - 1);
    if (r) return r;
  }
  return null;
}

function run(cmd, args) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { windowsHide: true, maxBuffer: 1 << 24 }, (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())),
  );
}

async function download(url, file, onPct) {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'cinecode-studio' } });
  if (!res.ok) throw new Error(`İndirme başarısız (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  let last = -1;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => {
    got += c.length;
    const pct = total ? Math.floor((got / total) * 100) : -1;
    if (pct !== last && pct % 5 === 0) {
      last = pct;
      onPct(pct, got);
    }
  });
  await pipeline(body, fs.createWriteStream(file));
}

async function extract(kind, file, dest) {
  await fsp.mkdir(dest, { recursive: true });
  if (kind === 'tgz') return tar.x({ file, cwd: dest });
  if (kind === 'zip') {
    // Windows 10/11'de yerleşik bsdtar (tar.exe) zip açabilir.
    const sysTar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'unzip';
    return process.platform === 'win32' ? run(sysTar, ['-xf', file, '-C', dest]) : run('unzip', ['-q', file, '-d', dest]);
  }
  if (kind === 'txz') return run('tar', ['-xJf', file, '-C', dest]);
  throw new Error(`Bilinmeyen arşiv türü: ${kind}`);
}

/**
 * Tek bir aracı indirip kurar.
 * @param {string} id python | ffmpeg | node
 * @param {(msg: string) => void} onProgress
 */
export async function installTool(id, onProgress = () => {}) {
  const spec = specs()[id];
  if (!spec) throw new Error(`${id} bu sistemde otomatik kurulamıyor.`);
  const root = toolsDir();
  await fsp.mkdir(root, { recursive: true });
  const tmpDir = path.join(root, `.${id}-${Date.now()}`);
  const archive = `${tmpDir}.download`;
  try {
    await download(spec.url, archive, (pct, bytes) =>
      onProgress(pct >= 0 ? `${spec.label} indiriliyor… %${pct}` : `${spec.label} indiriliyor… ${Math.round(bytes / 1e6)} MB`),
    );
    onProgress(`${spec.label} açılıyor…`);
    await extract(spec.kind, archive, tmpDir);
    const final = path.join(root, id);
    await fsp.rm(final, { recursive: true, force: true });
    await fsp.rename(tmpDir, final);
    // cinecode betikleri "python3" diye çağırabilir; Windows'ta bu ad yok, bir kopyasını oluştur.
    if (id === 'python' && process.platform === 'win32') {
      const exe = findFile(final, 'python.exe', 3);
      if (exe) await fsp.copyFile(exe, path.join(path.dirname(exe), 'python3.exe'));
    }
    onProgress(`${spec.label} kuruldu.`);
  } finally {
    await fsp.rm(archive, { force: true });
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}
