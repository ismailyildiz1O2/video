// Cinecode Studio — arayüz mantığı (framework yok).
'use strict';

const $ = (s) => document.querySelector(s);
const api = window.studio;

const state = {
  settings: null,
  projects: [],
  current: null, // proje dizini
  busy: false,
  media: [],
  playing: null,
  live: new Set(), // aktif (cevap bekleyen) kart id'leri
};

// ---------- yardımcılar ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
}
function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.round(s / 60)} dk`;
  if (s < 86400) return `${Math.round(s / 3600)} sa`;
  return `${Math.round(s / 86400)} g`;
}

/** Güvenli, küçük bir Markdown dönüştürücü: önce kaçış, sonra biçim. */
function md(src) {
  const blocks = [];
  let text = esc(src).replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const inline = (t) =>
    t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="#" data-ext="$2">$1</a>');
  const lines = text.split('\n');
  const out = [];
  let list = null;
  let table = null;
  const flushList = () => {
    if (list) out.push(`<${list.t}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.t}>`);
    list = null;
  };
  const flushTable = () => {
    if (table) {
      const rows = table.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
      out.push(
        '<table>' +
          rows
            .map((r, i) => {
              const cells = r.replace(/^\s*\||\|\s*$/g, '').split('|');
              const tg = i === 0 ? 'th' : 'td';
              return `<tr>${cells.map((c) => `<${tg}>${inline(c.trim())}</${tg}>`).join('')}</tr>`;
            })
            .join('') +
          '</table>',
      );
    }
    table = null;
  };
  for (const line of lines) {
    let m;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList();
      (table ||= []).push(line);
      continue;
    }
    flushTable();
    if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      if (list?.t !== 'ul') flushList();
      (list ||= { t: 'ul', items: [] }).items.push(m[1]);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list?.t !== 'ol') flushList();
      (list ||= { t: 'ol', items: [] }).items.push(m[1]);
    } else {
      flushList();
      if ((m = line.match(/^(#{1,4})\s+(.*)/))) out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`);
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
  }
  flushList();
  flushTable();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-ext]');
  if (a) {
    e.preventDefault();
    api.shell.external(a.dataset.ext);
  }
});

// ---------- kenar çubuğu ----------
async function refreshProjects() {
  state.projects = await api.projects.list();
  const ul = $('#projectList');
  ul.replaceChildren(
    ...state.projects.map((p) =>
      el(
        'li',
        { class: p.dir === state.current ? 'active' : '', title: p.dir, onclick: () => openProject(p.dir) },
        el('span', { class: 'p-name' }, p.name),
        p.hasSession ? el('span', { class: 'p-dot', title: 'Devam eden oturum' }) : null,
      ),
    ),
  );
  if (!state.projects.length) ul.append(el('li', { class: 'muted' }, 'Henüz film yok'));
}

async function refreshSkillState() {
  const s = await api.skill.status();
  $('#skillState').textContent = s.installed ? `cinecode ${s.managed ? (s.sha ? s.sha.slice(0, 7) : 'kurulu') : '(elle kurulmuş)'}` : 'cinecode kurulu değil';
  return s;
}

async function renderChecklist() {
  const box = $('#setupChecklist');
  const [settings, skill, reqs] = await Promise.all([api.settings.get(), api.skill.status(), api.requirements()]);
  const items = [
    { ok: settings.hasApiKey, label: 'Anthropic API anahtarı', fix: 'Ayarlar\'dan ekle' },
    { ok: skill.installed, label: 'cinecode kiti', fix: 'Ayarlar\'dan kur' },
    ...reqs.map((r) => ({ ok: r.ok, label: r.label, fix: 'Ajan kurmayı teklif eder' })),
  ];
  box.replaceChildren(
    el('div', { class: 'section-label' }, 'Hazırlık'),
    ...items.map((i) =>
      el('div', { class: 'check-item' }, el('span', { class: `s ${i.ok ? 'ok' : 'bad'}` }, i.ok ? '✓' : '✗'), el('span', {}, i.label), i.ok ? null : el('span', { class: 'muted' }, `— ${i.fix}`)),
    ),
  );
}

// ---------- proje açma ----------
async function openProject(dir) {
  const r = await api.projects.open(dir);
  state.current = r.dir;
  state.live.clear();
  $('#filmTitle').textContent = r.meta?.name || dir.split(/[\\/]/).pop();
  $('#filmPath').textContent = r.dir;
  $('#revealBtn').classList.remove('hidden');
  $('#input').disabled = false;
  $('#sendBtn').disabled = false;
  $('#messages').replaceChildren();
  // Geçmişi çiz; cevaplanmış kartları kapalı göster.
  const resolved = new Map(r.history.filter((e) => e.kind === 'resolved').map((e) => [e.id, e.value]));
  for (const ev of r.history) {
    if (ev.kind === 'resolved') continue;
    render(ev, { replay: true, resolved, live: r.busy });
  }
  setBusy(r.busy);
  if (!r.history.length) {
    $('#messages').append(
      el('div', { class: 'notice' }, 'Yeni film. Fikrini yaz ya da “Kısa film yapmak istiyorum” de; cinecode sana birkaç soru soracak.'),
    );
  }
  scrollDown(true);
  await refreshProjects();
  state.playing = null;
  await refreshMedia(true);
  $('#input').focus();
}

function setBusy(b) {
  state.busy = b;
  $('#busy').classList.toggle('hidden', !b);
  $('#stopBtn').classList.toggle('hidden', !b);
}

function scrollDown(force = false) {
  const m = $('#messages');
  if (force || m.scrollHeight - m.scrollTop - m.clientHeight < 200) m.scrollTop = m.scrollHeight;
}

// ---------- olayları çizme ----------
function render(ev, ctx = {}) {
  const box = $('#messages');
  switch (ev.kind) {
    case 'user':
      box.append(el('div', { class: 'msg user' }, ev.text));
      break;
    case 'assistant':
      box.append(el('div', { class: 'msg assistant', html: md(ev.text) }));
      break;
    case 'tool':
      box.append(el('div', { class: `tool${ev.sub ? ' sub' : ''}`, title: ev.summary }, '› ', el('b', {}, ev.name), ' ', ev.summary));
      break;
    case 'notice':
      box.append(el('div', { class: 'notice' }, ev.text));
      break;
    case 'error':
      box.append(el('div', { class: 'error' }, ev.text));
      break;
    case 'result':
      box.append(
        el('div', { class: 'result' }, ev.ok ? '✓ Tur bitti' : `✗ ${ev.text || 'Hata'}`, ev.cost != null ? ` · $${Number(ev.cost).toFixed(2)}` : ''),
      );
      break;
    case 'question':
      box.append(questionCard(ev, ctx));
      break;
    case 'permission':
      box.append(permissionCard(ev, ctx));
      break;
    case 'resolved': {
      const card = document.querySelector(`[data-card="${ev.id}"]`);
      if (card) closeCard(card, ev.value);
      break;
    }
    default:
      return;
  }
  scrollDown();
}

function closeCard(card, value) {
  state.live.delete(card.dataset.card);
  card.classList.add('done');
  card.querySelectorAll('button, input').forEach((b) => (b.disabled = true));
  const act = card.querySelector('.card-actions');
  if (act) {
    let txt = 'Cevaplanmadı';
    if (value?.answers) txt = '✓ Cevaplandı';
    else if (value && 'allow' in value) txt = value.allow ? (value.always ? '✓ İzin verildi (hep)' : '✓ İzin verildi') : '✗ Reddedildi';
    act.replaceChildren(el('span', { class: 'muted' }, txt));
  }
}

function isLive(ev, ctx) {
  if (!ctx.replay) return true;
  return ctx.live && !ctx.resolved.has(ev.id);
}

function questionCard(ev, ctx) {
  const card = el('div', { class: 'card', 'data-card': ev.id });
  const picks = ev.questions.map(() => new Set());
  const others = [];
  ev.questions.forEach((q, qi) => {
    const opts = el('div', { class: 'opts' });
    q.options.forEach((o) => {
      const b = el(
        'button',
        {
          type: 'button',
          class: 'opt',
          onclick: () => {
            const set = picks[qi];
            if (q.multiSelect) set.has(o.label) ? set.delete(o.label) : set.add(o.label);
            else {
              set.clear();
              set.add(o.label);
              others[qi].value = '';
            }
            opts.querySelectorAll('.opt').forEach((x) => x.classList.toggle('sel', set.has(x.dataset.label)));
          },
        },
        el('div', {}, o.label),
        o.description ? el('div', { class: 'd' }, o.description) : null,
        o.preview ? el('pre', {}, o.preview) : null,
      );
      b.dataset.label = o.label;
      opts.append(b);
    });
    const other = el('input', { type: 'text', placeholder: 'Diğer: kendi cevabını yaz…' });
    other.addEventListener('input', () => {
      if (other.value && !q.multiSelect) {
        picks[qi].clear();
        opts.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel'));
      }
    });
    others.push(other);
    card.append(el('div', {}, el('h4', {}, q.header ? el('span', { class: 'chip' }, q.header) : null, q.question)), opts, other);
  });
  const submit = el('button', {
    type: 'button',
    class: 'btn primary',
    onclick: () => {
      const answers = {};
      for (let i = 0; i < ev.questions.length; i++) {
        const vals = [...picks[i]];
        if (others[i].value.trim()) vals.push(others[i].value.trim());
        if (!vals.length) {
          others[i].focus();
          others[i].placeholder = 'Bir seçenek seç ya da cevabını yaz';
          return;
        }
        answers[ev.questions[i].question] = vals.join(', ');
      }
      api.chat.answer(state.current, ev.id, { answers });
    },
  }, 'Cevapla');
  card.append(el('div', { class: 'card-actions' }, submit));
  if (isLive(ev, ctx)) state.live.add(ev.id);
  else setTimeout(() => closeCard(card, ctx.resolved?.get(ev.id)));
  return card;
}

function permissionCard(ev, ctx) {
  const card = el(
    'div',
    { class: 'card perm', 'data-card': ev.id },
    el('h4', {}, el('span', { class: 'chip' }, 'İzin'), `Ajan şunu çalıştırmak istiyor: ${ev.toolName}`),
    el('code', {}, ev.summary),
  );
  const reply = (allow, always = false) => api.chat.answer(state.current, ev.id, { allow, always });
  card.append(
    el(
      'div',
      { class: 'card-actions' },
      el('button', { type: 'button', class: 'btn ghost danger', onclick: () => reply(false) }, 'Reddet'),
      el('button', { type: 'button', class: 'btn ghost', onclick: () => reply(true, true) }, ev.toolName === 'Bash' ? 'Bu oturumda tüm komutlara izin ver' : 'Bu filmde hep izin ver'),
      el('button', { type: 'button', class: 'btn primary', onclick: () => reply(true) }, 'İzin ver'),
    ),
  );
  if (isLive(ev, ctx)) state.live.add(ev.id);
  else setTimeout(() => closeCard(card, ctx.resolved?.get(ev.id)));
  return card;
}

// ---------- önizleme ----------
let mediaTimer = null;
function scheduleMedia() {
  clearTimeout(mediaTimer);
  mediaTimer = setTimeout(() => refreshMedia(false), 700);
}

const ICON = { mp4: '🎬', mov: '🎬', webm: '🎬', png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', wav: '🔊', mp3: '🔊', m4a: '🔊' };
const ext = (p) => p.split('.').pop().toLowerCase();

async function refreshMedia(autoPick) {
  if (!state.current) return;
  const dir = state.current;
  const list = await api.projects.media(dir);
  if (dir !== state.current) return;
  const prevNewest = state.media[0]?.mtime || 0;
  state.media = list;
  const ul = $('#mediaList');
  ul.replaceChildren(
    ...list.map((f) =>
      el(
        'li',
        { class: state.playing === f.path ? 'active' : '', title: f.rel, onclick: () => play(f), ondblclick: () => api.shell.open(f.path) },
        el('span', { class: 'ico' }, ICON[ext(f.path)] || '•'),
        el('span', { class: 'nm' }, f.rel),
        el('span', { class: 'tm' }, timeAgo(f.mtime)),
      ),
    ),
  );
  if (!list.length) ul.append(el('li', { class: 'muted' }, 'Dosya yok'));
  // Yeni bir video çıktıysa onu otomatik göster.
  const newestVideo = list.find((f) => ['mp4', 'mov', 'webm'].includes(ext(f.path)));
  if (autoPick && list[0]) play(newestVideo || list[0]);
  else if (newestVideo && newestVideo.mtime > prevNewest && prevNewest) play(newestVideo);
  else if (!list.length) showEmpty();
}

function showEmpty() {
  const p = $('#player');
  p.className = 'player empty';
  p.replaceChildren('Henüz bir taslak yok');
}

function play(f) {
  state.playing = f.path;
  const p = $('#player');
  const url = `${api.mediaUrl(f.path)}?v=${Math.round(f.mtime)}`;
  const e = ext(f.path);
  let node;
  if (['mp4', 'mov', 'webm'].includes(e)) node = el('video', { src: url, controls: '', autoplay: '' });
  else if (['wav', 'mp3', 'm4a'].includes(e)) node = el('audio', { src: url, controls: '' });
  else node = el('img', { src: url, alt: f.rel });
  p.className = 'player';
  p.replaceChildren(node);
  let meta = $('#playerMeta');
  if (!meta) {
    meta = el('div', { id: 'playerMeta', class: 'player-meta' });
    p.after(meta);
  }
  meta.replaceChildren(
    el('span', { class: 'nm' }, f.rel),
    el('a', { href: '#', onclick: (ev) => (ev.preventDefault(), api.shell.reveal(f.path)) }, 'Klasörde göster'),
  );
  document.querySelectorAll('#mediaList li').forEach((li) => li.classList.toggle('active', li.title === f.rel));
}

// ---------- ayarlar ----------
async function openSettings() {
  const s = await api.settings.get();
  $('#apiKey').value = '';
  $('#apiKeyHint').textContent = s.hasApiKey ? `Kayıtlı anahtar: ${s.apiKeyHint} (değiştirmek için yenisini yaz)` : 'Anahtar yok.';
  $('#model').replaceChildren(...s.models.map((m) => el('option', { value: m.id, selected: m.id === s.model ? '' : null }, m.label)));
  $('#effort').replaceChildren(...s.efforts.map((x) => el('option', { value: x, selected: x === s.effort ? '' : null }, x)));
  $('#projectsDir').value = s.projectsDir;
  $('#autoUpdateSkill').checked = s.autoUpdateSkill;
  const sk = await api.skill.status();
  $('#skillInfo').textContent = sk.installed
    ? `${sk.dir}${sk.managed ? ` · sürüm ${sk.sha ? sk.sha.slice(0, 7) : '?'}` : ' · elle kurulmuş (uygulama dokunmaz)'}`
    : 'Kurulu değil.';
  $('#skillUpdate').textContent = sk.installed ? 'Şimdi güncelle' : 'Kur';
  $('#skillUpdate').disabled = sk.installed && !sk.managed;
  $('#reqList').replaceChildren(el('li', { class: 'muted' }, 'Denetleniyor…'));
  $('#settingsDlg').showModal();
  const reqs = await api.requirements();
  $('#reqList').replaceChildren(
    ...reqs.map((r) =>
      el(
        'li',
        {},
        el('span', { class: r.ok ? 'ok' : 'bad' }, r.ok ? '✓' : '✗'),
        el('span', {}, r.label),
        el('span', { class: 'dt', title: r.detail }, r.detail),
        r.ok ? null : el('a', { href: '#', 'data-ext': r.help }, 'İndir'),
      ),
    ),
  );
}

$('#openSettings').addEventListener('click', openSettings);
$('#pickDir').addEventListener('click', async () => {
  const d = await api.settings.pickDir();
  if (d) $('#projectsDir').value = d;
});
$('#skillUpdate').addEventListener('click', async () => {
  const b = $('#skillUpdate');
  b.disabled = true;
  b.textContent = 'İndiriliyor…';
  try {
    await api.skill.install(true);
  } catch (e) {
    alert(`cinecode kurulamadı: ${e.message}`);
  }
  await refreshSkillState();
  $('#settingsDlg').close();
  openSettings();
});
$('#settingsForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  const patch = {
    model: $('#model').value,
    effort: $('#effort').value,
    projectsDir: $('#projectsDir').value,
    autoUpdateSkill: $('#autoUpdateSkill').checked,
  };
  if ($('#apiKey').value.trim()) patch.apiKey = $('#apiKey').value.trim();
  state.settings = await api.settings.set(patch);
  await refreshProjects();
  if (!state.current) renderChecklist();
});

// ---------- yeni film ----------
$('#newFilm').addEventListener('click', async () => {
  const s = await api.settings.get();
  if (!s.hasApiKey) {
    await openSettings();
    return;
  }
  $('#newName').value = '';
  $('#newIdea').value = '';
  $('#newDlg').showModal();
  $('#newName').focus();
});
$('#newDlg').addEventListener('close', async () => {
  if ($('#newDlg').returnValue !== 'create') return;
  const name = $('#newName').value.trim() || 'Yeni film';
  const idea = $('#newIdea').value.trim();
  const p = await api.projects.create(name);
  await refreshProjects();
  await openProject(p.dir);
  if (idea) sendMessage(idea);
});

// ---------- gönderme ----------
async function sendMessage(text) {
  if (!state.current || !text.trim()) return;
  try {
    await api.chat.send(state.current, text);
  } catch (e) {
    render({ kind: 'error', text: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
  }
}
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('#input').value;
  $('#input').value = '';
  sendMessage(t);
});
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});
$('#stopBtn').addEventListener('click', () => state.current && api.chat.interrupt(state.current));
$('#revealBtn').addEventListener('click', () => state.current && api.shell.open(state.current));
$('#refreshMedia').addEventListener('click', () => refreshMedia(false));

// ---------- ana süreçten gelen olaylar ----------
api.chat.onEvent((ev) => {
  if (ev.dir !== state.current) {
    if (ev.kind === 'question' || ev.kind === 'permission') refreshProjects();
    return;
  }
  if (ev.kind === 'busy') return setBusy(ev.busy);
  if (ev.kind === 'media-changed') return scheduleMedia();
  render(ev);
});
api.skill.onProgress((m) => {
  $('#skillState').textContent = m;
  setTimeout(refreshSkillState, 2500);
});

// ---------- başlangıç ----------
(async function init() {
  state.settings = await api.settings.get();
  await Promise.all([refreshProjects(), refreshSkillState(), renderChecklist()]);
  if (!state.settings.hasApiKey) openSettings();
})();
