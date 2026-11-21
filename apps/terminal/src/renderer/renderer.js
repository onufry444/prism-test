'use strict';
// Prism: karty terminala, skróty, wiadomości z powłoki, powitanie i samouczek.
// Ustawienia (settings.js) korzystają ze wspólnego obiektu window.Prism.
{
const api = window.api;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAC = api.platform === 'darwin';
const rgb = h => { const n = parseInt(String(h).slice(1), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const hexA = (h, a) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };

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

const P = window.Prism = { api, $, esc, rgb, hexA, ANSI, PRESETS, MAC, S: null, profiles: [], tabs: [], active: null, acrylic: false };
const events = {};
P.on = (n, f) => (events[n] = events[n] || []).push(f);
P.emit = (n, ...a) => (events[n] || []).forEach(f => f(...a));

// ---------- zapis ustawień ----------
let saveT;
P.save = now => {
  clearTimeout(saveT);
  const S = P.S;
  const run = () => api.setSettings({ look: S.look, commands: S.commands, defaultProfile: S.defaultProfile, desktopBlur: S.desktopBlur, onboarding: S.onboarding })
    .then(s => { P.S.commands = s.commands; P.emit('commands'); });
  if (now) run(); else saveT = setTimeout(run, 250);
};
P.toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(P.toast.t); P.toast.t = setTimeout(() => t.classList.remove('show'), 2400); };

// ---------- wygląd terminala ----------
function termOptions() {
  const L = P.S.look;
  return {
    fontFamily: L.font, fontSize: L.size, lineHeight: L.lineHeight, cursorStyle: L.cursor, cursorBlink: L.blink,
    theme: { background: 'rgba(0,0,0,0)', foreground: L.fg, cursor: L.accent, cursorAccent: L.bg, selectionBackground: L.accent + '55', ...ANSI[L.ansi] || ANSI.dark }
  };
}
P.applyLook = () => {
  const L = P.S.look, r = document.documentElement.style;
  r.setProperty('--tbg', hexA(L.bg, L.opacity / 100));
  r.setProperty('--solid', L.bg); r.setProperty('--fg', L.fg); r.setProperty('--ac', L.accent);
  r.setProperty('--pad', L.padding + 'px'); r.setProperty('--rad', L.radius + 'px'); r.setProperty('--mono', L.font);
  for (const t of P.tabs) Object.assign(t.term.options, termOptions());
  fitActive();
  P.emit('look');
};
P.setLook = (patch, custom = true) => { Object.assign(P.S.look, patch, custom ? { preset: null } : {}); P.applyLook(); P.save(); };
P.usePreset = id => {
  const p = PRESETS.find(p => p.id === id || p.n.toLowerCase() === String(id).toLowerCase());
  if (!p) return false;
  P.setLook({ opacity: p.opacity, bg: p.bg, fg: p.fg, accent: p.accent, ansi: p.ansi, preset: p.id }, false);
  return true;
};

// ---------- karty ----------
function fitActive() { if (!P.active) return; try { P.active.fit.fit(); } catch {} }
function welcome() {
  const [r, g, b] = rgb(P.S.look.accent), A = `\x1b[38;2;${r};${g};${b}m`, B = '\x1b[1m', D = '\x1b[2m', R = '\x1b[0m';
  return [
    '', `  ${A}◆${R}  ${B}Witaj w Prism${R}`,
    `     ${D}Twój terminal i centrum sterowania wyglądem Windowsa.${R}`, '',
    `     ${A}settings${R}          ustawienia: motyw Windows, kolory, tapeta, okna`,
    `     ${A}pomoc${R}             wszystkie komendy Prism`,
    `     ${A}dodaj-komende${R}     własna komenda, np. dodaj-komende hej "Cześć {1}!"`,
    `     ${A}tutorial${R}          samouczek krok po kroku`, '',
    `     ${D}Samouczek czeka w prawym dolnym rogu. W ustawieniach wszystko klikasz myszką.${R}`, '', ''
  ].join('\r\n');
}
P.newTab = async (profileId, opts = {}) => {
  const el = document.createElement('div');
  el.className = 'term';
  $('#terms').appendChild(el);
  const term = new Terminal({ ...termOptions(), allowTransparency: true, scrollback: 10000, macOptionIsMeta: true });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => api.openExternal(uri)));
  term.open(el);
  const t = { id: crypto.randomUUID(), term, fit, el, title: '…', profile: null };
  P.tabs.push(t);
  activate(t);
  if (opts.welcome) term.write(welcome());
  term.onData(d => api.write(t.id, d));
  term.onResize(({ cols, rows }) => api.resize(t.id, cols, rows));
  term.onTitleChange(s => { t.title = s || t.profile?.name || 'terminal'; renderTabs(); });
  term.parser.registerOscHandler(7777, d => { handleMsg(d); return true; });
  term.attachCustomKeyEventHandler(e => keys(e, t));
  const r = await api.create(t.id, profileId, term.cols, term.rows);
  t.profile = r.profile;
  if (t.title === '…') t.title = r.profile.name;
  renderTabs();
  if (P.tabs.length >= 2) P.tourDone('tab');
  return t;
};
function activate(t) {
  P.active = t;
  for (const x of P.tabs) x.el.classList.toggle('on', x === t);
  renderTabs();
  requestAnimationFrame(() => { fitActive(); if ($('#settings').hidden) t.term.focus(); });
}
function closeTab(t, fromExit) {
  if (!t) return;
  if (!fromExit) api.kill(t.id);
  t.term.dispose(); t.el.remove();
  const i = P.tabs.indexOf(t);
  P.tabs.splice(i, 1);
  if (!P.tabs.length) return api.win('close');
  if (P.active === t) activate(P.tabs[Math.min(i, P.tabs.length - 1)]); else renderTabs();
}
function renderTabs() {
  $('#tabs').innerHTML = P.tabs.map((t, i) => `<button class="tab${t === P.active ? ' on' : ''}" data-i="${i}" title="${esc(t.title)}"><span class="dot"></span><span class="t">${esc(t.title)}</span><span class="x" data-x="${i}" aria-label="Zamknij kartę">×</span></button>`).join('');
}
P.typeInActive = text => { if (!P.active) return; P.closeSettings?.(); api.write(P.active.id, text); P.active.term.focus(); };
$('#tabs').addEventListener('mousedown', e => {
  const x = e.target.closest('[data-x]'), b = e.target.closest('.tab');
  if (!b) return;
  const t = P.tabs[+(x || b).dataset[x ? 'x' : 'i']];
  if (x || e.button === 1) { e.preventDefault(); closeTab(t); } else { P.closeSettings?.(); activate(t); }
});
$('#add').addEventListener('click', () => P.newTab());
$('#addMenu').addEventListener('click', e => { e.stopPropagation(); $('#profiles').hidden = !$('#profiles').hidden; });
$('#profiles').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { $('#profiles').hidden = true; P.newTab(b.dataset.id); } });
document.addEventListener('click', e => { if (!e.target.closest('.newtab')) $('#profiles').hidden = true; });
new ResizeObserver(fitActive).observe($('#terms'));

// ---------- skróty ----------
function keys(e, t) {
  if (e.type !== 'keydown') return true;
  const mod = MAC ? e.metaKey : e.ctrlKey, k = e.key.toLowerCase();
  const stop = () => { e.preventDefault(); return false; };
  if ((mod && e.shiftKey && k === 't') || (MAC && e.metaKey && k === 't')) { P.newTab(); return stop(); }
  if ((mod && e.shiftKey && k === 'w') || (MAC && e.metaKey && k === 'w')) { closeTab(t); return stop(); }
  if (e.ctrlKey && k === 'tab') { const i = P.tabs.indexOf(t); activate(P.tabs[(i + (e.shiftKey ? -1 : 1) + P.tabs.length) % P.tabs.length]); return stop(); }
  if (e.altKey && /^[1-9]$/.test(e.key) && P.tabs[+e.key - 1]) { activate(P.tabs[+e.key - 1]); return stop(); }
  if (mod && e.key === ',') { P.toggleSettings(); return stop(); }
  if (mod && (e.key === '=' || e.key === '+')) { P.setLook({ size: Math.min(28, P.S.look.size + 1) }, false); return stop(); }
  if (mod && e.key === '-') { P.setLook({ size: Math.max(10, P.S.look.size - 1) }, false); return stop(); }
  const copy = MAC ? e.metaKey && k === 'c' : e.ctrlKey && ((e.shiftKey && k === 'c') || (!e.shiftKey && k === 'c' && t.term.hasSelection()));
  if (copy) { if (t.term.hasSelection()) { api.clipWrite(t.term.getSelection()); t.term.clearSelection(); } return stop(); }
  const paste = MAC ? e.metaKey && k === 'v' : e.ctrlKey && k === 'v';
  if (paste) { api.clipRead().then(s => s && t.term.paste(s)); return stop(); }
  return true;
}
document.addEventListener('contextmenu', e => {
  if (!P.active || !e.target.closest('.term')) return;
  e.preventDefault();
  if (P.active.term.hasSelection()) { api.clipWrite(P.active.term.getSelection()); P.active.term.clearSelection(); P.toast('Skopiowano'); }
  else api.clipRead().then(s => s && P.active.term.paste(s));
});

// ---------- komendy własne ----------
const RESERVED = ['settings', 'ustawienia', 'tutorial', 'pomoc', 'motyw', 'krycie', 'czcionka', 'dodaj-komende', 'komendy', 'prism'];
P.upsertCmd = (c, oldName) => {
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,40}$/.test(c.name)) throw new Error('Nazwa: litery, cyfry, _ lub -, bez spacji i polskich znaków.');
  if (RESERVED.includes(c.name)) throw new Error(`„${c.name}” to komenda Prism, wybierz inną nazwę.`);
  if (!c.body.trim()) throw new Error('Treść nie może być pusta.');
  P.S.commands = P.S.commands.filter(x => x.name !== c.name && x.name !== oldName);
  P.S.commands.push({ name: c.name, type: c.type === 'run' ? 'run' : 'text', body: c.body, desc: c.desc || '' });
  P.S.commands.sort((a, b) => a.name.localeCompare(b.name));
  P.save(true);
  P.emit('commands');
  P.tourDone('command');
};

// ---------- wiadomości z powłoki ----------
const b64utf8 = s => new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
function handleMsg(data) {
  const i = data.indexOf(';'), cmd = i < 0 ? data : data.slice(0, i), arg = i < 0 ? '' : data.slice(i + 1).trim();
  if (cmd === 'panel') { P.openSettings(arg); P.tourDone('settings'); }
  else if (cmd === 'tutorial') { P.S.onboarding.hidden = false; P.save(); P.closeSettings(); renderTour(); }
  else if (cmd === 'theme') { if (!P.usePreset(arg)) P.toast('Kolory terminala: ' + PRESETS.map(p => p.id).join(', ')); }
  else if (cmd === 'opacity') {
    const v = Math.round(+arg);
    if (arg !== '' && v >= 0 && v <= 100) { P.setLook({ opacity: v }, false); P.tourDone('opacity'); } else P.toast('Użycie: krycie 0-100');
  } else if (cmd === 'font') {
    const v = Math.round(+arg);
    if (v >= 10 && v <= 28) P.setLook({ size: v }, false); else P.toast('Użycie: czcionka 10-28');
  } else if (cmd === 'add') {
    try {
      const [type, name, ...body] = b64utf8(arg).split('\t');
      P.upsertCmd({ name, type, body: body.join('\t'), desc: '' });
      P.toast(`Komenda ${name} zapisana`);
    } catch (err) { P.toast(err.message || 'Nie udało się dodać komendy'); }
  }
}
api.onShellMsg(handleMsg);

// ---------- samouczek ----------
const STEPS = [
  { id: 'settings', title: 'Otwórz ustawienia', text: 'Wpisz komendę i naciśnij Enter. W ustawieniach wszystko obsłużysz myszką.', cmd: 'settings' },
  { id: 'apply', title: 'Zastosuj motyw w Windows', text: 'Wybierz motyw i kliknij „Zastosuj w Windows”. Do oryginału wrócisz jednym kliknięciem.', act: ['Otwórz motywy', () => P.openSettings('theme')] },
  { id: 'opacity', title: 'Zmień przezroczystość', text: 'Komendą albo suwakiem w ustawieniach (Terminal).', cmd: 'krycie 60' },
  { id: 'command', title: 'Dodaj własną komendę', text: 'Potem wpisz: hej Ola', cmd: 'dodaj-komende hej "Cześć {1}!"' },
  { id: 'tab', title: 'Otwórz nową kartę', text: MAC ? 'Skrót Cmd+T albo przycisk + na górze.' : 'Skrót Ctrl+Shift+T albo przycisk + na górze.', act: ['Nowa karta', () => P.newTab()] }
];
P.STEPS = STEPS;
P.tourActive = () => P.S && !P.S.onboarding.hidden && STEPS.some(s => !P.S.onboarding.done.includes(s.id));
P.tourNext = () => STEPS.find(s => !P.S.onboarding.done.includes(s.id));
P.tourDone = id => {
  const o = P.S?.onboarding;
  if (!o || o.done.includes(id)) return;
  o.done.push(id);
  P.save();
  renderTour(); P.emit('tour');
  if (STEPS.every(s => o.done.includes(s.id)) && !o.hidden) {
    P.toast('Samouczek ukończony. Ściąga: pomoc');
    setTimeout(() => { o.hidden = true; P.save(); renderTour(); }, 5000);
  }
};
function renderTour() {
  const o = P.S.onboarding, el = $('#tour');
  if (o.hidden || !$('#settings').hidden) { el.hidden = true; return; }
  el.hidden = false;
  const n = STEPS.filter(s => o.done.includes(s.id)).length, next = P.tourNext();
  el.innerHTML = `<header><b>Samouczek</b><span>${n} z ${STEPS.length}</span><button class="ic sm" data-t="close" title="Ukryj (wróci komendą tutorial)" aria-label="Ukryj samouczek">✕</button></header>
    <div class="prog"><i style="width:${n / STEPS.length * 100}%"></i></div>
    <ol>${STEPS.map((s, i) => {
      const done = o.done.includes(s.id), cur = s === next;
      return `<li class="${done ? 'done' : ''}${cur ? ' cur' : ''}"><span class="mk">${done ? '✓' : i + 1}</span><div><b>${esc(s.title)}</b>${cur ? `<p>${esc(s.text)}</p>${s.cmd ? `<button class="chip" data-t="type" data-i="${i}"><code>${esc(s.cmd)}</code><span>Wpisz</span></button>` : ''}${s.act ? `<button class="chip solo" data-t="act" data-i="${i}">${esc(s.act[0])}</button>` : ''}` : ''}</div></li>`;
    }).join('')}</ol>
    ${next ? '' : '<p class="fin">Wszystko gotowe! Listę komend pokaże <code>pomoc</code>.</p>'}`;
}
P.renderTour = renderTour;
$('#tour').addEventListener('click', e => {
  const b = e.target.closest('[data-t]');
  if (!b) return;
  const s = STEPS[+b.dataset.i];
  if (b.dataset.t === 'close') { P.S.onboarding.hidden = true; P.save(); renderTour(); P.toast('Samouczek wrócisz komendą tutorial'); }
  else if (b.dataset.t === 'type') P.typeInActive(s.cmd);
  else if (b.dataset.t === 'act') s.act[1]();
});

// ---------- okno ----------
$('#wc').addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) api.win(b.dataset.w); });
$('.drag').addEventListener('dblclick', () => api.win('max'));
$('#gear').addEventListener('click', () => P.toggleSettings());
api.onWinState(m => document.body.classList.toggle('maxed', m));
api.onAppCommand(c => { if (c === 'settings') P.openSettings(); else P.newTab(); });
api.onSettingsChanged(s => { P.S = s; P.applyLook(); P.emit('commands'); P.emit('settings'); renderTour(); });

// ---------- start ----------
api.onData(({ id, data }) => P.tabs.find(t => t.id === id)?.term.write(data));
api.onExit(({ id }) => closeTab(P.tabs.find(t => t.id === id), true));

api.getSettings().then(async r => {
  P.S = r.settings; P.profiles = r.profiles; P.acrylic = r.acrylicCapable;
  $('#profiles').innerHTML = P.profiles.map(p => `<button data-id="${esc(p.id)}">${esc(p.name)}<small>${p.kind === 'other' ? 'bez komend Prism' : esc(p.kind)}</small></button>`).join('');
  P.applyLook();
  const first = !P.S.onboarding.welcomed;
  await P.newTab(undefined, { welcome: first });
  if (first) { P.S.onboarding.welcomed = true; P.save(); }
  renderTour();
  if (r.startup.openSettings) P.openSettings();
});
}
