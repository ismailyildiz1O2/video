// cinecode skill'ini kurar ve günceller.
// Skill, upstream README'nin önerdiği yere (~/.claude/skills/cinecode) kurulur;
// böylece Claude Code ile de aynı kopya kullanılır. Git gerekmez: GitHub'dan
// tarball indirilip açılır.
import { net } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';

export const REPO = 'sarpstar/cinecode';
export const BRANCH = 'main';
const MARKER = '.cinecode-studio.json';

export function skillDir() {
  return path.join(os.homedir(), '.claude', 'skills', 'cinecode');
}

function readMarker(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @returns {{installed: boolean, managed: boolean, dir: string, sha?: string, installedAt?: string}}
 * managed=false: kullanıcı kendisi (git ile) kurmuş; ona dokunmayız.
 */
export function skillStatus() {
  const dir = skillDir();
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) return { installed: false, managed: true, dir };
  const m = readMarker(dir);
  if (!m) return { installed: true, managed: false, dir };
  return { installed: true, managed: true, dir, sha: m.sha, installedAt: m.installedAt };
}

async function latestSha() {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cinecode-studio' },
    });
    if (!res.ok) return null;
    return (await res.json()).sha || null;
  } catch {
    return null;
  }
}

/**
 * Skill'i kurar ya da (force/yenisi varsa) günceller.
 * @param {{force?: boolean, onProgress?: (msg: string) => void}} opts
 */
export async function ensureSkill({ force = false, onProgress = () => {} } = {}) {
  const status = skillStatus();
  if (status.installed && !status.managed) {
    onProgress('cinecode zaten elle kurulmuş, o kopya kullanılıyor.');
    return status;
  }
  const sha = await latestSha();
  if (status.installed && !force && (!sha || sha === status.sha)) return status;

  onProgress(status.installed ? 'cinecode güncelleniyor…' : 'cinecode indiriliyor…');
  const ref = sha || BRANCH;
  const res = await net.fetch(`https://codeload.github.com/${REPO}/tar.gz/${ref}`, {
    headers: { 'User-Agent': 'cinecode-studio' },
  });
  if (!res.ok) throw new Error(`İndirme başarısız: HTTP ${res.status}`);

  const dir = skillDir();
  const parent = path.dirname(dir);
  await fsp.mkdir(parent, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(parent, '.cinecode-new-'));
  try {
    await pipeline(Readable.fromWeb(res.body), tar.x({ cwd: tmp, strip: 1 }));
    if (!fs.existsSync(path.join(tmp, 'SKILL.md'))) throw new Error('İndirilen arşivde SKILL.md yok.');
    await fsp.writeFile(
      path.join(tmp, MARKER),
      JSON.stringify({ sha: sha || null, installedAt: new Date().toISOString(), repo: REPO }, null, 2),
    );
    // Eski kopyayı kenara al, yenisini yerine koy, eskisini sil.
    const old = `${dir}.old-${Date.now()}`;
    if (fs.existsSync(dir)) await fsp.rename(dir, old).catch(() => fsp.rm(dir, { recursive: true, force: true }));
    try {
      await fsp.rename(tmp, dir);
    } catch {
      // Windows'ta virüs tarayıcısı klasörü kilitleyebilir; taşımak yerine kopyala.
      await fsp.cp(tmp, dir, { recursive: true });
    }
    if (fs.existsSync(old)) await fsp.rm(old, { recursive: true, force: true }).catch(() => {});
  } catch (err) {
    await fsp.rm(tmp, { recursive: true, force: true });
    throw err;
  }
  onProgress('cinecode hazır.');
  return skillStatus();
}
