// Uçtan uca test: Python, ffmpeg ve Node.js'i geçici bir klasöre indirip kurar,
// sonra her birini uygulamanın kullandığı PATH ile çalıştırır.
// Çalıştırma: npx electron test/tools-e2e.mjs
// Windows'ta Electron bir GUI uygulaması olduğu için konsol çıktısı görünmeyebilir;
// bu yüzden her satır ayrıca TOOLS_E2E_LOG dosyasına (varsayılan: tools-e2e.log) yazılır.
import { app } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const logFile = process.env.TOOLS_E2E_LOG || path.resolve('tools-e2e.log');
fs.writeFileSync(logFile, '');
const log = (m) => {
  console.log(m);
  fs.appendFileSync(logFile, m + '\n');
};
const finish = (code) => {
  log(code === 0 ? 'SONUÇ: TAMAM' : 'SONUÇ: HATA');
  app.exit(code);
};
process.on('uncaughtException', (e) => (log(`yakalanmamış hata: ${e.stack || e}`), finish(1)));
process.on('unhandledRejection', (e) => (log(`yakalanmamış hata: ${e?.stack || e}`), finish(1)));
setTimeout(() => (log('zaman aşımı (15 dk)'), finish(1)), 15 * 60 * 1000).unref?.();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cinecode-tools-'));
app.setPath('userData', tmp);
log(`platform: ${process.platform}-${process.arch}, userData: ${tmp}`);

app.whenReady().then(async () => {
  const { installTool, toolBinDirs, canAutoInstall } = await import('../src/main/tools.mjs');
  const { envWithPath } = await import('../src/main/requirements.mjs');
  let failed = false;
  const win = process.platform === 'win32';
  const checks = {
    python: [win ? 'python3.exe' : 'python3', ['--version']],
    ffmpeg: [win ? 'ffmpeg.exe' : 'ffmpeg', ['-version']],
    node: [win ? 'node.exe' : 'node', ['--version']],
  };
  for (const id of Object.keys(checks)) {
    if (!canAutoInstall(id)) {
      log(`${id}: bu platformda otomatik kurulum yok, atlandı`);
      continue;
    }
    const t0 = Date.now();
    try {
      await installTool(id, (m) => /%(25|50|75|100)$|kuruldu|açılıyor/.test(m) && log(`  ${m}`));
      const dir = toolBinDirs().find((d) => fs.existsSync(path.join(d, checks[id][0])));
      if (!dir) throw new Error('çalıştırılabilir dosya bulunamadı');
      const out = execFileSync(path.join(dir, checks[id][0]), checks[id][1], { env: envWithPath(), encoding: 'utf8', timeout: 60000, windowsHide: true });
      log(`${id}: TAMAM → ${out.split('\n')[0].trim()} (${Math.round((Date.now() - t0) / 1000)} sn, ${dir})`);
    } catch (err) {
      failed = true;
      log(`${id}: HATA → ${err.message}`);
    }
  }
  log(`PATH başı: ${envWithPath().PATH.split(path.delimiter).slice(0, 3).join(' | ')}`);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
  finish(failed ? 1 : 0);
});
