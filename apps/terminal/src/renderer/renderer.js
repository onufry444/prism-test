'use strict';
{
const api = window.api;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MAC = api.platform === 'darwin';

const ANSI = {
  dark: { black: '#1d1f21', red: '#ff6b6b', green: '#7ee787', yellow: '#f2cc60', blue: '#79c0ff', magenta: '#d2a8ff', cyan: '#76e3ea', white: '#d0d0d0',
    brightBlack: '#6e7681', brightRed: '#ff8f8f', brightGreen: '#a5f3b4', brightYellow: '#ffe08a', brightBlue: '#a5d6ff', brightMagenta: '#e2c5ff', brightCyan: '#b3f0f5', brightWhite: '#ffffff' },
  light: { black: '#2a2622', red: '#c4302b', green: '#2f7d32', yellow: '#9a6b00', blue: '#1f5fbf', magenta: '#8e3fae', cyan: '#0f7c86', white: '#6b6560',
    brightBlack: '#8a847c', brightRed: '#e04a3f', brightGreen: '#3a9a3e', brightYellow: '#b38200', brightBlue: '#2f74d8', brightMagenta: '#a957c9', brightCyan: '#1a96a1', brightWhite: '#2a2622' }
};
const PRESETS = [
  { id: 'grafit', n: 'Grafit', opacity: 78, bg: '#101216', fg: '#e7e5df', accent: '#7ee0b5', ansi: 'dark' },
  { id: 'szklo', n: 'Szkło', opacity: 30, bg: '#0b0d14', fg: '#ffffff', accent: '#ffd27a', ansi: 'dark' },
  { id: 'papier', n: 'Papier', opacity: 94, bg: '#f4efe4', fg: '#2a2622', accent: '#c2410c', ansi: 'light' },
  { id: 'fosfor', n: 'Fosfor', opacity: 86, bg: '#06120b', fg: '#9cf2b4', accent: '#35d07f', ansi: 'dark' },
  { id: 'morze', n: 'Morze', opacity: 62, bg: '#0a1f2e', fg: '#d6ecf5', accent: '#5cc8ff', ansi: 'dark' },
  { id: 'sliwka', n: 'Śliwka', opacity: 58, bg: '#1e0f24', fg: '#f2e4f5', accent: '#ff8fb1', ansi: 'dark' }
];
const KEYS = [
  ['Nowa karta', 'Ctrl+Shift+T'], ['Zamknij kartę', 'Ctrl+Shift+W'], ['Następna / poprzednia karta', 'Ctrl+Tab / Ctrl+Shift+Tab'],
  ['Karta 1–9', 'Alt+1…9'], ['Kopiuj', 'Ctrl+Shift+C (lub Ctrl+C z zaznaczeniem)'], ['Wklej', 'Ctrl+Shift+V / Ctrl+V'],
  ['Większa / mniejsza czcionka', 'Ctrl+= / Ctrl+−'], ['Ustawienia', 'Ctrl+,'], ['Szukaj w historii', 'zależnie od powłoki']
].map(([a, b]) => MAC ? [a, b.replace(/Ctrl\+Shift\+([TWCV])/g, 'Cmd+$1').replace(/Ctrl\+([,=−])/g, 'Cmd+$1')] : [a, b]);

let S, PROFILES, ACRYLIC;
const tabs = [];
let active = null;

// ---------- zapis ustawień (z opóźnieniem) ----------
let saveT;
function save(now) {
  clearTimeout(saveT);
  const run = () => api.setSettings({ look: S.look, commands: S.commands, defaultProfile: S.defaultProfile, desktopBlur: S.desktopBlur }).then(s => { S.commands = s.commands; renderCmds(); });
  now ? run() : (saveT = setTimeout(run, 250));
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800); }

// ---------- wygląd ----------
const rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
function termOptions() {
  const L = S.look;
  return {
    fontFamily: L.font, fontSize: L.size, lineHeight: L.lineHeight, cursorStyle: L.cursor, cursorBlink: L.blink,
    theme: { background: 'rgba(0,0,0,0)', foreground: L.fg, cursor: L.accent, cursorAccent: L.bg, selectionBackground: L.accent + '55', ...ANSI[L.ansi] }
  };
}
function applyLook() {
  const L = S.look, r = document.documentElement.style, [a, b, c] = rgb(L.bg);
  r.setProperty('--tbg', `rgba(${a},${b},${c},${L.opacity / 100})`);
  r.setProperty('--solid', L.bg); r.setProperty('--fg', L.fg); r.setProperty('--ac', L.accent);
  r.setProperty('--pad', L.padding + 'px'); r.setProperty('--rad', L.radius + 'px'); r.setProperty('--mono', L.font);
  for (const t of tabs) { Object.assign(t.term.options, termOptions()); }
  fitActive();
  syncForm();
}
const fields = { opacity: '%', size: ' px', lineHeight: '', padding: ' px', radius: ' px' };
function syncForm() {
  const L = S.look;
  for (const k of ['opacity', 'bg', 'fg', 'accent', 'ansi', 'size', 'lineHeight', 'padding', 'radius', 'cursor']) { const el = $('#' + k); if (document.activeElement !== el) el.value = L[k]; }
  if (document.activeElement !== $('#font')) $('#font').value = L.font;
  $('#blink').value = L.blink ? '1' : '0';
  for (const [k, u] of Object.entries(fields)) $('#' + k + 'V').textContent = (k === 'lineHeight' ? (+L[k]).toFixed(2) : L[k]) + u;
  document.querySelectorAll('.pre').forEach(p => p.classList.toggle('on', p.dataset.id === L.preset));
}
function setLook(patch, custom = true) { Object.assign(S.look, patch, custom ? { preset: null } : {}); applyLook(); save(); }
function usePreset(id) {
  const p = PRESETS.find(p => p.id === id || p.n.toLowerCase() === String(id).toLowerCase());
  if (!p) return false;
  setLook({ opacity: p.opacity, bg: p.bg, fg: p.fg, accent: p.accent, ansi: p.ansi, preset: p.id }, false);
  return true;
}

// ---------- karty ----------
function fitActive() { if (!active) return; try { active.fit.fit(); } catch {} }
async function newTab(profileId) {
  const el = document.createElement('div');
  el.className = 'term';
  $('#terms').appendChild(el);
  const term = new Terminal({ ...termOptions(), allowTransparency: true, scrollback: 10000, allowProposedApi: true, macOptionIsMeta: true });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => api.openExternal(uri)));
  term.open(el);
  const t = { id: crypto.randomUUID(), term, fit, el, title: '…', profile: null };
  tabs.push(t);
  activate(t);
  term.onData(d => api.write(t.id, d));
  term.onResize(({ cols, rows }) => api.resize(t.id, cols, rows));
  term.onTitleChange(s => { t.title = s || t.profile?.name || 'terminal'; renderTabs(); });
  term.parser.registerOscHandler(7777, d => { handleOsc(d); return true; });
  term.attachCustomKeyEventHandler(e => keys(e, t));
  const r = await api.create(t.id, profileId, term.cols, term.rows);
  t.profile = r.profile;
  if (t.title === '…') t.title = r.profile.name;
  renderTabs();
}
function activate(t) {
  active = t;
  for (const x of tabs) x.el.classList.toggle('on', x === t);
  renderTabs();
  requestAnimationFrame(() => { fitActive(); t.term.focus(); });
}
function closeTab(t, fromExit) {
  if (!t) return;
  if (!fromExit) api.kill(t.id);
  t.term.dispose(); t.el.remove();
  const i = tabs.indexOf(t);
  tabs.splice(i, 1);
  if (!tabs.length) return api.win('close');
  if (active === t) activate(tabs[Math.min(i, tabs.length - 1)]); else renderTabs();
}
function renderTabs() {
  $('#tabs').innerHTML = tabs.map((t, i) => `<button class="tab${t === active ? ' on' : ''}" data-i="${i}" title="${esc(t.title)}"><span class="dot"></span><span class="t">${esc(t.title)}</span><span class="x" data-x="${i}" aria-label="Zamknij kartę">×</span></button>`).join('');
}
$('#tabs').addEventListener('mousedown', e => {
  const x = e.target.closest('[data-x]'), b = e.target.closest('.tab');
  if (!b) return;
  const t = tabs[+(x || b).dataset[x ? 'x' : 'i']];
  if (x || e.button === 1) { e.preventDefault(); closeTab(t); } else activate(t);
});
$('#add').addEventListener('click', () => newTab());
$('#addMenu').addEventListener('click', e => { e.stopPropagation(); $('#profiles').hidden = !$('#profiles').hidden; });
$('#profiles').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { $('#profiles').hidden = true; newTab(b.dataset.id); } });
document.addEventListener('click', e => { if (!e.target.closest('.newtab')) $('#profiles').hidden = true; });
new ResizeObserver(fitActive).observe($('#terms'));

// ---------- skróty ----------
function keys(e, t) {
  if (e.type !== 'keydown') return true;
  const mod = MAC ? e.metaKey : e.ctrlKey, k = e.key.toLowerCase();
  const stop = () => { e.preventDefault(); return false; };
  if (mod && e.shiftKey && k === 't' || MAC && e.metaKey && k === 't') { newTab(); return stop(); }
  if (mod && e.shiftKey && k === 'w' || MAC && e.metaKey && k === 'w') { closeTab(t); return stop(); }
  if (e.ctrlKey && k === 'tab') { const i = tabs.indexOf(t); activate(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]); return stop(); }
  if (e.altKey && /^[1-9]$/.test(e.key) && tabs[+e.key - 1]) { activate(tabs[+e.key - 1]); return stop(); }
  if (mod && (e.key === ',')) { togglePanel(); return stop(); }
  if (mod && (e.key === '=' || e.key === '+')) { setLook({ size: Math.min(28, S.look.size + 1) }, false); return stop(); }
  if (mod && e.key === '-') { setLook({ size: Math.max(10, S.look.size - 1) }, false); return stop(); }
  const copy = MAC ? e.metaKey && k === 'c' : e.ctrlKey && (e.shiftKey && k === 'c' || !e.shiftKey && k === 'c' && t.term.hasSelection());
  if (copy) { if (t.term.hasSelection()) { api.clipWrite(t.term.getSelection()); t.term.clearSelection(); } return stop(); }
  const paste = MAC ? e.metaKey && k === 'v' : e.ctrlKey && k === 'v';
  if (paste) { api.clipRead().then(s => s && t.term.paste(s)); return stop(); }
  return true;
}
document.addEventListener('contextmenu', e => {
  if (!active || !e.target.closest('.term')) return;
  e.preventDefault();
  if (active.term.hasSelection()) { api.clipWrite(active.term.getSelection()); active.term.clearSelection(); toast('Skopiowano'); }
  else api.clipRead().then(s => s && active.term.paste(s));
});

// ---------- komendy z terminala (OSC 7777) ----------
function b64utf8(s) { const bin = atob(s); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
function handleOsc(data) {
  const i = data.indexOf(';'), cmd = i < 0 ? data : data.slice(0, i), arg = i < 0 ? '' : data.slice(i + 1).trim();
  if (cmd === 'theme') {
    if (!usePreset(arg)) active?.term.write(`\r\nMotywy: ${PRESETS.map(p => p.id).join(', ')}\r\n`);
  } else if (cmd === 'opacity') {
    const v = Math.round(+arg); if (v >= 0 && v <= 100) setLook({ opacity: v }, false); else active?.term.write('\r\nużycie: krycie 0-100\r\n');
  } else if (cmd === 'font') {
    const v = Math.round(+arg); if (v >= 10 && v <= 28) setLook({ size: v }, false); else active?.term.write('\r\nużycie: czcionka 10-28\r\n');
  } else if (cmd === 'panel') {
    openPanel(['look', 'cmd', 'gen'].includes(arg) ? arg : arg === 'komendy' ? 'cmd' : 'look');
  } else if (cmd === 'add') {
    try {
      const [type, name, ...body] = b64utf8(arg).split('\t');
      upsertCmd({ name, type, body: body.join('\t'), desc: '' });
      toast(`Komenda ${name} zapisana`);
    } catch (err) { toast(err.message || 'Nie udało się dodać komendy'); }
  }
}

// ---------- komendy: panel ----------
const RESERVED = ['motyw', 'krycie', 'czcionka', 'ustawienia', 'dodaj-komende', 'komendy'];
let editing = null;
function upsertCmd(c, oldName) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,40}$/.test(c.name)) throw new Error('Nazwa: litery, cyfry, _ lub -, bez spacji i polskich znaków.');
  if (RESERVED.includes(c.name)) throw new Error(`„${c.name}” to komenda aplikacji.`);
  if (!c.body.trim()) throw new Error('Treść nie może być pusta.');
  S.commands = S.commands.filter(x => x.name !== c.name && x.name !== oldName);
  S.commands.push({ name: c.name, type: c.type === 'run' ? 'run' : 'text', body: c.body, desc: c.desc || '' });
  S.commands.sort((a, b) => a.name.localeCompare(b.name));
  renderCmds();
  save(true);
}
function renderCmds() {
  $('#cmds').innerHTML = S.commands.length ? S.commands.map((c, i) => `<li><b>${esc(c.name)}</b><button data-e="${i}">Edytuj</button><button data-d="${i}">Usuń</button><small>${esc(c.desc || (c.type === 'run' ? '▸ ' : '') + c.body.split('\n')[0])}</small></li>`).join('')
    : '<li class="empty">Nie masz jeszcze własnych komend.</li>';
}
$('#cmds').addEventListener('click', e => {
  const ed = e.target.closest('[data-e]'), del = e.target.closest('[data-d]');
  if (del) { const c = S.commands[+del.dataset.d]; S.commands.splice(+del.dataset.d, 1); renderCmds(); save(true); toast(`Usunięto ${c.name}`); if (editing === c.name) resetForm(); }
  if (ed) { const c = S.commands[+ed.dataset.e]; editing = c.name; $('#cName').value = c.name; $('#cType').value = c.type; $('#cBody').value = c.body; $('#cDesc').value = c.desc || ''; $('#formTitle').textContent = 'Edycja: ' + c.name; $('#cCancel').hidden = false; $('#cName').focus(); }
});
function resetForm() { editing = null; $('#cmdForm').reset(); $('#formTitle').textContent = 'Nowa komenda'; $('#cCancel').hidden = true; $('#cErr').textContent = ''; }
$('#cCancel').addEventListener('click', resetForm);
$('#cmdForm').addEventListener('submit', e => {
  e.preventDefault();
  try {
    const name = $('#cName').value.trim();
    upsertCmd({ name, type: $('#cType').value, body: $('#cBody').value, desc: $('#cDesc').value.trim() }, editing);
    toast(`Komenda ${name} zapisana`); resetForm();
  } catch (err) { $('#cErr').textContent = err.message; }
});

// ---------- panel ----------
function openPanel(sec) {
  $('#panel').hidden = false;
  document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('on', b.dataset.p === sec));
  document.querySelectorAll('[data-sec]').forEach(s => s.hidden = s.dataset.sec !== sec);
}
function togglePanel() { if ($('#panel').hidden) openPanel('look'); else { $('#panel').hidden = true; active?.term.focus(); } }
$('#gear').addEventListener('click', togglePanel);
$('#closePanel').addEventListener('click', togglePanel);
$('#seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) openPanel(b.dataset.p); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#panel').hidden) togglePanel(); });

$('#presets').innerHTML = PRESETS.map(p => `<button class="pre" data-id="${p.id}" style="background:${p.bg};color:${p.fg}"><span style="color:${p.accent}">❯</span> ${p.n}</button>`).join('');
$('#presets').addEventListener('click', e => { const b = e.target.closest('.pre'); if (b) usePreset(b.dataset.id); });
for (const k of ['opacity', 'size', 'lineHeight', 'padding', 'radius']) $('#' + k).addEventListener('input', e => setLook({ [k]: +e.target.value }, false));
for (const k of ['bg', 'fg', 'accent', 'ansi']) $('#' + k).addEventListener('input', e => setLook({ [k]: e.target.value }));
$('#cursor').addEventListener('change', e => setLook({ cursor: e.target.value }, false));
$('#blink').addEventListener('change', e => setLook({ blink: e.target.value === '1' }, false));
$('#font').addEventListener('change', e => setLook({ font: e.target.value.trim() || 'monospace' }, false));
$('#defProfile').addEventListener('change', e => { S.defaultProfile = e.target.value; save(true); });
$('#desktopBlur').addEventListener('change', e => { S.desktopBlur = e.target.checked; save(true); $('#relaunch').hidden = false; });
$('#relaunch').addEventListener('click', () => api.win('relaunch'));

// ---------- okno ----------
$('#wc').addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) api.win(b.dataset.w); });
$('.drag').addEventListener('dblclick', () => api.win('max'));
api.onWinState(m => document.body.classList.toggle('maxed', m));

// ---------- start ----------
api.onData(({ id, data }) => tabs.find(t => t.id === id)?.term.write(data));
api.onExit(({ id }) => closeTab(tabs.find(t => t.id === id), true));

api.getSettings().then(r => {
  S = r.settings; PROFILES = r.profiles; ACRYLIC = r.acrylicCapable;
  $('#profiles').innerHTML = PROFILES.map((p, i) => `<button data-id="${esc(p.id)}">${esc(p.name)}${i < 9 ? '' : ''}<small>${p.kind === 'other' ? 'bez własnych komend' : p.kind}</small></button>`).join('');
  $('#defProfile').innerHTML = PROFILES.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('#defProfile').value = S.defaultProfile || PROFILES[0].id;
  $('#desktopBlur').checked = S.desktopBlur;
  if (!ACRYLIC) $('#blurHint').textContent = 'Twój system tego nie obsługuje (działa na Windows 11 i macOS). Sama przezroczystość działa wszędzie.';
  $('#keys').innerHTML = KEYS.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  applyLook(); renderCmds(); newTab();
});
}
