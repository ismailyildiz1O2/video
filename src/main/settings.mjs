// Uygulama ayarları: userData/settings.json içinde saklanır.
// API anahtarı işletim sisteminin anahtar zinciriyle (safeStorage) şifrelenir.
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULTS = {
  model: 'claude-opus-5-5',
  effort: 'high',
  projectsDir: path.join(os.homedir(), 'Documents', 'Cinecode Filmleri'),
  apiKeyEnc: null, // base64, safeStorage ile şifreli
  apiKeyPlain: null, // safeStorage kullanılamıyorsa (bazı Linux masaüstleri)
  autoUpdateSkill: true,
};

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (önerilen)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (daha ucuz)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (en güçlü, en pahalı)' },
];

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(s, null, 2), { mode: 0o600 });
}

export function getApiKey() {
  const s = loadSettings();
  if (s.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64'));
    } catch {
      return null;
    }
  }
  return s.apiKeyPlain || process.env.ANTHROPIC_API_KEY || null;
}

/** Arayüze gönderilecek, gizli bilgi içermeyen görünüm. */
export function publicSettings() {
  const s = loadSettings();
  const key = getApiKey();
  return {
    model: s.model,
    effort: s.effort,
    projectsDir: s.projectsDir,
    autoUpdateSkill: s.autoUpdateSkill,
    hasApiKey: Boolean(key),
    apiKeyHint: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null,
    models: MODELS,
    efforts: EFFORTS,
  };
}

export function updateSettings(patch) {
  const s = loadSettings();
  if (typeof patch.apiKey === 'string') {
    const k = patch.apiKey.trim();
    if (!k) {
      s.apiKeyEnc = null;
      s.apiKeyPlain = null;
    } else if (safeStorage.isEncryptionAvailable()) {
      s.apiKeyEnc = safeStorage.encryptString(k).toString('base64');
      s.apiKeyPlain = null;
    } else {
      s.apiKeyPlain = k;
      s.apiKeyEnc = null;
    }
  }
  if (patch.model && MODELS.some((m) => m.id === patch.model)) s.model = patch.model;
  if (patch.effort && EFFORTS.includes(patch.effort)) s.effort = patch.effort;
  if (typeof patch.projectsDir === 'string' && patch.projectsDir) s.projectsDir = patch.projectsDir;
  if (typeof patch.autoUpdateSkill === 'boolean') s.autoUpdateSkill = patch.autoUpdateSkill;
  save(s);
  return publicSettings();
}
