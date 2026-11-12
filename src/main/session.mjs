// Bir film projesi için Claude ajan oturumu (Claude Agent SDK).
// Ajan, cinecode skill'ini kullanarak filmi proje klasöründe kodla üretir.
// Sorular (AskUserQuestion) ve izin istekleri arayüze iletilir, cevap beklenir.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { app } from 'electron';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { envWithPath } from './requirements.mjs';
import { readMeta, writeMeta, appendChat } from './projects.mjs';
import { loadSettings } from './settings.mjs';

const require = createRequire(import.meta.url);

/** Paketlenmiş uygulamada SDK'nın yerel ikilisi app.asar.unpacked içinde durur. */
function claudeExecutable() {
  if (!app.isPackaged) return undefined; // geliştirmede SDK kendisi bulur
  const libc = process.platform === 'linux' && !process.report?.getReport?.().header?.glibcVersionRuntime ? '-musl' : '';
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${libc}`;
  try {
    const dir = path.dirname(require.resolve(`${pkg}/package.json`)).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    const bin = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
    return fs.existsSync(bin) ? bin : undefined;
  } catch {
    return undefined;
  }
}

// Kullanıcıya sormadan çalışabilen araçlar. Dosya yazma/düzenleme 'acceptEdits' kipiyle
// sadece proje klasörü içinde otomatik onaylanır; Bash ve geri kalan her şey için izin istenir.
const AUTO_ALLOWED = ['Read', 'Glob', 'Grep', 'Skill', 'TodoWrite', 'WebSearch', 'WebFetch', 'Agent', 'ToolSearch'];

const APPEND_PROMPT = `Bu oturum "Cinecode Studio" masaüstü uygulamasında çalışıyor. Kullanıcı bir terminal görmüyor; sadece senin yazdığın metni, sorularını (AskUserQuestion) ve proje klasöründeki medya dosyalarını (mp4, png, jpg, wav) bir önizleme panelinde görüyor.
- Kullanıcı film yapmak istediğinde cinecode skill'ini kullan.
- Seçim gerektiren her soruyu AskUserQuestion aracıyla sor; uygulama bunları tıklanabilir kartlar olarak gösterir.
- Taslakları, kareleri ve son filmi proje klasörüne kaydet ki önizleme panelinde görünsün; dosyanın göreli yolunu metinde de belirt.
- Python, ffmpeg ve Node.js'i uygulama kendisi kurar ve PATH'e koyar; bunları sistem geneline kurmaya ya da kullanıcıdan kurmasını istemeye çalışma. Bir araç gerçekten eksikse kullanıcıya Ayarlar > "Eksikleri kur" düğmesini söyle.
- Kullanıcıyla onun dilinde konuş (varsayılan Türkçe).`;

/** Araç çağrısını kısa bir satırla özetle. */
function summarizeTool(name, input = {}) {
  const s = (v) => String(v ?? '').replace(/\s+/g, ' ').slice(0, 140);
  switch (name) {
    case 'Bash':
      return input.description ? `${s(input.description)} — ${s(input.command)}` : s(input.command);
    case 'Read':
    case 'Write':
    case 'Edit':
      return s(input.file_path);
    case 'Glob':
    case 'Grep':
      return s(input.pattern);
    case 'Skill':
      return s(input.skill);
    case 'WebSearch':
      return s(input.query);
    case 'WebFetch':
      return s(input.url);
    case 'Agent':
      return s(input.description || input.prompt);
    case 'TodoWrite':
      return `${(input.todos || []).length} görev`;
    default:
      return s(JSON.stringify(input));
  }
}

export class FilmSession {
  /**
   * @param {{dir: string, apiKey: string, model: string, effort: string, emit: (ev: object) => void}} opts
   */
  constructor({ dir, apiKey, model, effort, emit }) {
    this.dir = dir;
    this.apiKey = apiKey;
    this.model = model;
    this.effort = effort;
    this.emit = emit;
    this.queue = [];
    this.waiter = null;
    this.closed = false;
    this.busy = false;
    this.pending = new Map(); // id -> {resolve, kind}
    this.q = null;
  }

  /** Olayı arayüze gönder ve kalıcı sohbet geçmişine yaz. */
  out(ev, persist = true) {
    const e = { ts: Date.now(), ...ev };
    if (persist) appendChat(this.dir, e);
    this.emit(e);
  }

  async *input() {
    while (!this.closed) {
      if (!this.queue.length) {
        await new Promise((r) => (this.waiter = r));
        this.waiter = null;
        continue;
      }
      const text = this.queue.shift();
      yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    }
  }

  /** @param {string} text @param {string[]} refs proje içindeki referans dosyalarının mutlak yolları */
  send(text, refs = []) {
    if (this.closed) return;
    this.out({ kind: 'user', text, refs: refs.length ? refs : undefined });
    let prompt = text.trim() || 'Referans dosyaları ekledim.';
    if (refs.length) {
      const rel = refs.map((p) => path.relative(this.dir, p).split(path.sep).join('/'));
      prompt +=
        `\n\n[Kullanıcı ${rel.length} referans dosyası ekledi, proje klasöründe: ${rel.join(', ')}. ` +
        'Görselleri Read ile açıp incele; videoları ve şarkıları cinecode\'un referans video / şarkı adımlarıyla değerlendir. ' +
        'Bunları filmin görünümü, rengi, ışığı, tipografisi ya da biçimi için referans olarak kullan ve neyi nasıl kullanacağını kısaca söyle. ' +
        'Görüntüleri doğrudan filme koyma; sadece ilham ve ölçü olarak kullan.]';
    }
    this.queue.push(prompt);
    this.setBusy(true);
    this.waiter?.();
    if (!this.q) this.start();
  }

  setBusy(b) {
    this.busy = b;
    this.out({ kind: 'busy', busy: b }, false);
  }

  ask(kind, payload, signal) {
    const id = randomUUID();
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, kind });
      this.out({ kind, id, ...payload });
      signal?.addEventListener('abort', () => {
        if (this.pending.delete(id)) {
          this.out({ kind: 'resolved', id }, true);
          resolve(null);
        }
      });
    });
  }

  /** Arayüzden gelen cevap (soru ya da izin). */
  answer(id, value) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    this.out({ kind: 'resolved', id, value });
    p.resolve(value);
  }

  canUseTool = async (toolName, input, { signal, suggestions }) => {
    if (toolName === 'AskUserQuestion') {
      const res = await this.ask('question', { questions: input.questions || [] }, signal);
      if (!res) return { behavior: 'deny', message: 'Kullanıcı soruyu cevaplamadı.' };
      return { behavior: 'allow', updatedInput: { ...input, answers: res.answers, annotations: res.annotations } };
    }
    // "İzin sormadan devam et" açıksa her araç çağrısı onaylanır; ayar canlı okunur,
    // böylece Ayarlar'dan değiştirince hemen geçerli olur.
    if (loadSettings().autoApprove) return { behavior: 'allow', updatedInput: input };
    const res = await this.ask('permission', { toolName, summary: summarizeTool(toolName, input) }, signal);
    if (res?.allow) {
      // Bash için "hep izin ver": cinecode çok sayıda farklı komut çalıştırır (render, ffmpeg, kontroller);
      // tek tek sormak yerine bu oturum boyunca tüm komutlara izin verilir.
      const always =
        toolName === 'Bash'
          ? [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' }]
          : suggestions;
      return { behavior: 'allow', updatedInput: input, updatedPermissions: res.always ? always : undefined };
    }
    return { behavior: 'deny', message: 'Kullanıcı bu işleme izin vermedi. Başka bir yol öner ya da nedenini sor.' };
  };

  start() {
    const meta = readMeta(this.dir) || {};
    const env = envWithPath({ ANTHROPIC_API_KEY: this.apiKey });
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ANTHROPIC_AUTH_TOKEN;

    this.q = query({
      prompt: this.input(),
      options: {
        cwd: this.dir,
        model: this.model,
        effort: this.effort,
        settingSources: ['user', 'project', 'local'],
        skills: ['cinecode'],
        permissionMode: 'acceptEdits',
        allowedTools: AUTO_ALLOWED,
        canUseTool: this.canUseTool,
        resume: meta.sessionId || undefined,
        env,
        pathToClaudeCodeExecutable: claudeExecutable(),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: APPEND_PROMPT },
        stderr: (d) => console.error('[claude]', d),
      },
    });
    this.loop().catch((err) => {
      this.out({ kind: 'error', text: String(err?.message || err) });
      this.setBusy(false);
      this.q = null;
    });
  }

  async loop() {
    for await (const m of this.q) {
      if (m.type === 'system' && m.subtype === 'init') {
        writeMeta(this.dir, { sessionId: m.session_id });
        const hasSkill = (m.skills || []).some((s) => String(s).includes('cinecode'));
        if (m.skills && !hasSkill) this.out({ kind: 'notice', text: 'Uyarı: cinecode skill\'i oturumda görünmüyor. Ayarlar > cinecode bölümünden kurun.' });
      } else if (m.type === 'assistant') {
        const sub = m.parent_tool_use_id != null;
        for (const b of m.message?.content || []) {
          if (b.type === 'text' && b.text?.trim()) {
            if (!sub) this.out({ kind: 'assistant', text: b.text });
          } else if (b.type === 'tool_use' && b.name !== 'AskUserQuestion') {
            this.out({ kind: 'tool', name: b.name, summary: summarizeTool(b.name, b.input), sub });
          }
        }
        if (m.error) this.out({ kind: 'error', text: `API hatası: ${m.error}` });
      } else if (m.type === 'user' && m.parent_tool_use_id == null) {
        // Araç sonuçları: yeni medya dosyası oluşmuş olabilir.
        this.out({ kind: 'media-changed' }, false);
      } else if (m.type === 'result') {
        const ok = m.subtype === 'success';
        this.out({
          kind: 'result',
          ok,
          cost: m.total_cost_usd,
          text: ok ? null : this.interrupted ? 'Durduruldu' : (m.errors || []).join('\n') || m.subtype,
        });
        this.interrupted = false;
        this.out({ kind: 'media-changed' }, false);
        if (!this.queue.length) this.setBusy(false);
      }
    }
    this.q = null;
    this.setBusy(false);
  }

  /** Ayar açılınca bekleyen izin kartlarını onaylar. */
  approvePending() {
    for (const [id, p] of this.pending) if (p.kind === 'permission') this.answer(id, { allow: true });
  }

  async interrupt() {
    this.interrupted = true;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.resolve(null);
      this.out({ kind: 'resolved', id });
    }
    try {
      await this.q?.interrupt();
    } catch (err) {
      this.out({ kind: 'error', text: String(err?.message || err) });
    }
  }

  close() {
    this.closed = true;
    for (const [, p] of this.pending) p.resolve(null);
    this.pending.clear();
    this.waiter?.();
    try {
      this.q?.close();
    } catch {}
    this.q = null;
  }
}
