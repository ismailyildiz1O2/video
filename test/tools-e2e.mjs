// Uçtan uca test: Python, ffmpeg ve Node.js'i geçici bir klasöre indirip kurar,
// sonra her birini uygulamanın kullandığı PATH ile çalıştırır.
// Çalıştırma: npx electron test/tools-e2e.mjs
import { app } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cinecode-tools-'));
app.setPath('userData', tmp);

app.whenReady().then(async () => {
  const { installTool, toolBinDirs, canAutoInstall } = await import('../src/main/tools.mjs');
  const { envWithPath } = await import('../src/main/requirements.mjs');
  let failed = false;
  const win = process.platform === 'win32';
  const checks = { python: [win ? 'python3.exe' : 'python3', ['--version']], ffmpeg: [win ? 'ffmpeg.exe' : 'ffmpeg', ['-version']], node: [win ? 'node.exe' : 'node', ['--version']] };
  for (const id of Object.keys(checks)) {
    if (!canAutoInstall(id)) {
      console.log(`${id}: bu platformda otomatik kurulum yok, atlandı`);
      continue;
    }
    try {
      await installTool(id, (m) => /%\d*[05]0$|kuruldu|açılıyor/.test(m) && console.log(`  ${m}`));
      const dir = toolBinDirs().find((d) => fs.existsSync(path.join(d, checks[id][0])));
      if (!dir) throw new Error('çalıştırılabilir dosya bulunamadı');
      const out = execFileSync(path.join(dir, checks[id][0]), checks[id][1], { env: envWithPath(), encoding: 'utf8' });
      console.log(`${id}: TAMAM → ${out.split('\n')[0]}  (${dir})`);
    } catch (err) {
      failed = true;
      console.error(`${id}: HATA → ${err.message}`);
    }
  }
  console.log('PATH başı:', envWithPath().PATH.split(path.delimiter).slice(0, 3).join(' | '));
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
});
