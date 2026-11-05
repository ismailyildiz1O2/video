// Film projeleri: her film, projeler klasöründe ayrı bir klasördür.
// Uygulamaya ait bilgiler <film>/.cinecode-studio/ altında tutulur.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const META_DIR = '.cinecode-studio';
const MEDIA_EXT = new Set(['.mp4', '.mov', '.webm', '.png', '.jpg', '.jpeg', '.gif', '.wav', '.mp3', '.m4a']);
const SKIP_DIRS = new Set(['node_modules', '.git', META_DIR, '.claude', 'frames', '__pycache__', 'cache', '.cache']);

function slugify(name) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
  return (
    name
      .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c])
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'film'
  );
}

function metaPath(dir) {
  return path.join(dir, META_DIR, 'project.json');
}

export function readMeta(dir) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(dir), 'utf8'));
  } catch {
    return null;
  }
}

export function writeMeta(dir, patch) {
  const meta = { ...(readMeta(dir) || {}), ...patch, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.join(dir, META_DIR), { recursive: true });
  fs.writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2));
  return meta;
}

export async function listProjects(root) {
  await fsp.mkdir(root, { recursive: true });
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = path.join(root, e.name);
    const meta = readMeta(dir);
    const stat = await fsp.stat(dir);
    out.push({
      dir,
      name: meta?.name || e.name,
      createdAt: meta?.createdAt || stat.birthtime.toISOString(),
      updatedAt: meta?.updatedAt || stat.mtime.toISOString(),
      hasSession: Boolean(meta?.sessionId),
    });
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export async function createProject(root, name) {
  await fsp.mkdir(root, { recursive: true });
  const base = slugify(name);
  let dir = path.join(root, base);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(root, `${base}-${i}`);
  await fsp.mkdir(dir, { recursive: true });
  writeMeta(dir, { name: name.trim() || base, createdAt: new Date().toISOString() });
  return { dir, name: name.trim() || base };
}

/** Bir dizinin projeler kökü içinde olup olmadığını denetler (path traversal'a karşı). */
export function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Projedeki son medya dosyaları (önizleme paneli için). */
export async function listMedia(dir, limit = 80) {
  const found = [];
  async function walk(d, depth) {
    if (depth > 4) return;
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(p, depth + 1);
      } else if (MEDIA_EXT.has(path.extname(e.name).toLowerCase())) {
        const st = await fsp.stat(p);
        found.push({ path: p, rel: path.relative(dir, p), size: st.size, mtime: st.mtimeMs });
      }
    }
  }
  await walk(dir, 0);
  found.sort((a, b) => b.mtime - a.mtime);
  return found.slice(0, limit);
}

// Sohbet geçmişi: arayüze giden olaylar <film>/.cinecode-studio/chat.jsonl içine yazılır,
// böylece proje yeniden açılınca konuşma görünür.
export function appendChat(dir, event) {
  fs.mkdirSync(path.join(dir, META_DIR), { recursive: true });
  fs.appendFileSync(path.join(dir, META_DIR, 'chat.jsonl'), JSON.stringify(event) + '\n');
}

export function readChat(dir) {
  try {
    return fs
      .readFileSync(path.join(dir, META_DIR, 'chat.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
