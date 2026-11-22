'use strict';
// Prism terminal window: tabs, keys, search, shell messages. Settings live in settings.js.
{
const api = window.api;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAC = api.platform === 'darwin';
const rgb = h => { const n = parseInt(String(h).slice(1), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const hexA = (h, a) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };
const SCHEMES = window.PRISM_SCHEMES;

const P = window.Prism = { api, $, esc, rgb, hexA, MAC, SCHEMES, C: null, cfg: null, profiles: [], tabs: [], active: null };
const events = {};
P.on = (n, f) => (events[n] = events[n] || []).push(f);
P.emit = (n, ...a) => (events[n] || []).forEach(f => f(...a));
P.toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(P.toast.t); P.toast.t = setTimeout(() => t.classList.remove('show'), 2600); };
P.set = async patch => { const cfg = await api.setConfig(patch); return cfg; };

// ---------- colors ----------
P.palette = cfg => {
  const t = (cfg || P.cfg).terminal, base = SCHEMES[t.scheme] || SCHEMES.prism;
  const own = Object.fromEntries(Object.entries(t.colors || {}).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v || '')));
  return { ...base, ...own };
};
function termOptions() {
  const t = P.cfg.terminal, c = P.palette();
  return {
    fontFamily: t.font, fontSize: t.fontSize, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing || 0, fontWeight: t.fontWeight || 'normal',
    cursorStyle: t.cursor, cursorBlink: t.cursorBlink, scrollback: t.scrollback,
    theme: {
      background: 'rgba(0,0,0,0)', foreground: c.foreground, cursor: c.cursor || c.accent, cursorAccent: c.background, selectionBackground: c.selection || c.accent + '55',
      black: c.black, red: c.red, green: c.green, yellow: c.yellow, blue: c.blue, magenta: c.magenta, cyan: c.cyan, white: c.white,
      brightBlack: c.brightBlack, brightRed: c.brightRed, brightGreen: c.brightGreen, brightYellow: c.brightYellow, brightBlue: c.brightBlue,
      brightMagenta: c.brightMagenta, brightCyan: c.brightCyan, brightWhite: c.brightWhite
    }
  };
}
function applyLook() {
  const t = P.cfg.terminal, c = P.palette(), r = document.documentElement.style;
  r.setProperty('--tbg', hexA(c.background, t.opacity / 100));
  r.setProperty('--solid', c.background); r.setProperty('--fg', c.foreground); r.setProperty('--ac', c.accent);
  r.setProperty('--pad', t.padding + 'px'); r.setProperty('--rad', t.radius + 'px'); r.setProperty('--mono', t.font);
  r.setProperty('--bgimg', t.backgroundImage ? `url("file:///${t.backgroundImage.replace(/\\/g, '/').replace(/^\/+/, '').replace(/"/g, '%22')}")` : 'none');
  r.setProperty('--bgimg-op', t.backgroundImageOpacity ?? .18);
  $('#user-css').textContent = P.C.css || '';
  for (const tab of P.tabs) Object.assign(tab.term.options, termOptions());
  fitActive();
}

// ---------- keys ----------
const parseKey = s => {
  const parts = String(s || '').split('+').map(x => x.trim()).filter(Boolean);
  const key = (parts.pop() || '').toLowerCase();
  const mods = parts.map(p => p.toLowerCase());
  return { key, ctrl: mods.includes('ctrl') || mods.includes('control') || mods.includes('cmdorctrl'), shift: mods.includes('shift'), alt: mods.includes('alt'), meta: mods.includes('cmd') || mods.includes('meta') || mods.includes('super') };
};
const keyMatch = (e, spec) => {
  if (!spec) return false;
  const k = parseKey(spec), ek = e.key.toLowerCase();
  const keyOk = ek === k.key || (k.key === '=' && ek === '+') || (k.key === 'plus' && ek === '+') || (k.key === 'tab' && ek === 'tab');
  return keyOk && e.ctrlKey === k.ctrl && e.shiftKey === k.shift && e.altKey === k.alt && e.metaKey === k.meta;
};

// ---------- tabs ----------
function fitActive() { if (!P.active) return; try { P.active.fit.fit(); } catch {} }
// opts: { run: { file, args, cwd, title } } runs one program; { adopt: { id, title } } shows a console Windows handed to Prism
P.newTab = async (profileId, cwd, opts = {}) => {
  const el = document.createElement('div');
  el.className = 'term';
  $('#terms').appendChild(el);
  const term = new Terminal({ ...termOptions(), allowTransparency: true, macOptionIsMeta: true, allowProposedApi: true });
  const fit = new FitAddon.FitAddon(), search = new SearchAddon.SearchAddon();
  term.loadAddon(fit); term.loadAddon(search);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => api.openExternal(uri)));
  term.open(el);
  const t = { id: opts.adopt ? opts.adopt.id : crypto.randomUUID(), term, fit, search, el, title: opts.adopt?.title || opts.run?.title || '…', profile: null };
  P.tabs.push(t);
  activate(t);
  term.onData(d => api.write(t.id, d));
  term.onResize(({ cols, rows }) => api.resize(t.id, cols, rows));
  term.onTitleChange(s => { t.title = cleanTitle(s) || t.profile?.name || 'shell'; renderTabs(); });
  term.onSelectionChange(() => { if (P.cfg.terminal.copyOnSelect && term.hasSelection()) api.clipWrite(term.getSelection()); });
  term.parser.registerOscHandler(7777, d => { handleMsg(d); return true; });
  term.attachCustomKeyEventHandler(e => keys(e, t));
  const r = opts.adopt ? await api.adopt(t.id, term.cols, term.rows) : await api.create(t.id, profileId, term.cols, term.rows, cwd, opts.run || null);
  if (!r.ok && opts.adopt) { closeTab(t, true); return null; }
  t.profile = r.profile;
  if (t.title === '…') t.title = r.profile.name;
  renderTabs();
  return t;
};
// "C:\WINDOWS\system32\cmd.exe - doskey ..." and "Administrator: ..." are noisy; keep the useful part
const cleanTitle = s => String(s || '').replace(/^Administrator:\s*/, '').replace(/^.*\\(cmd|powershell|pwsh)\.exe( - .*)?$/i, '$1').slice(0, 60);
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
  $('#tabs').innerHTML = P.tabs.map((t, i) => `<button class="tab${t === P.active ? ' on' : ''}${t.admin || P.elevated ? ' admin' : ''}" data-i="${i}" title="${esc(t.title)}${t.admin ? ' (running as administrator)' : ''}">${t.admin || P.elevated ? '<span class="sh" aria-label="administrator">⚡</span>' : ''}<span class="t">${esc(t.title)}</span><span class="x" data-x="${i}" aria-label="Close tab">×</span></button>`).join('');
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
$('#logo').addEventListener('click', () => api.menu());
new ResizeObserver(fitActive).observe($('#terms'));

// ---------- keyboard ----------
function keys(e, t) {
  if (e.type !== 'keydown') return true;
  const K = P.cfg.keys, stop = () => { e.preventDefault(); return false; };
  if (keyMatch(e, K.newTab) || (MAC && e.metaKey && e.key === 't')) { P.newTab(); return stop(); }
  if (keyMatch(e, K.closeTab) || (MAC && e.metaKey && e.key === 'w')) { closeTab(t); return stop(); }
  if (keyMatch(e, K.newWindow)) { api.win('new'); return stop(); }
  if (keyMatch(e, K.nextTab)) { const i = P.tabs.indexOf(t); activate(P.tabs[(i + 1) % P.tabs.length]); return stop(); }
  if (keyMatch(e, K.prevTab)) { const i = P.tabs.indexOf(t); activate(P.tabs[(i - 1 + P.tabs.length) % P.tabs.length]); return stop(); }
  if (e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key) && P.tabs[+e.key - 1]) { activate(P.tabs[+e.key - 1]); return stop(); }
  if (keyMatch(e, K.settings)) { P.toggleSettings(); return stop(); }
  if (keyMatch(e, K.search)) { openSearch(); return stop(); }
  if (keyMatch(e, K.zoomIn)) { P.set({ terminal: { fontSize: Math.min(32, P.cfg.terminal.fontSize + 1) } }); return stop(); }
  if (keyMatch(e, K.zoomOut)) { P.set({ terminal: { fontSize: Math.max(8, P.cfg.terminal.fontSize - 1) } }); return stop(); }
  if (keyMatch(e, K.zoomReset)) { P.set({ terminal: { fontSize: 14 } }); return stop(); }
  const copy = keyMatch(e, K.copy) || (MAC && e.metaKey && e.key === 'c') || (!MAC && e.ctrlKey && !e.shiftKey && e.key === 'c' && t.term.hasSelection());
  if (copy) { if (t.term.hasSelection()) { api.clipWrite(t.term.getSelection()); t.term.clearSelection(); } return stop(); }
  const paste = keyMatch(e, K.paste) || (MAC ? e.metaKey && e.key === 'v' : e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'v');
  if (paste) { api.clipRead().then(s => s && t.term.paste(s)); return stop(); }
  return true;
}
document.addEventListener('contextmenu', e => {
  if (!P.active || !e.target.closest('.term')) return;
  e.preventDefault();
  if (P.active.term.hasSelection()) { api.clipWrite(P.active.term.getSelection()); P.active.term.clearSelection(); P.toast('Copied'); }
  else if (P.cfg.terminal.rightClickPaste) api.clipRead().then(s => s && P.active.term.paste(s));
});

// ---------- search ----------
function openSearch() { $('#search').hidden = false; $('#searchInput').focus(); $('#searchInput').select(); }
function closeSearch() { $('#search').hidden = true; P.active?.search.clearDecorations(); P.active?.term.focus(); }
const findOpts = () => ({ decorations: { matchBackground: hexA(P.palette().accent, .35), activeMatchBackground: P.palette().accent, matchOverviewRuler: P.palette().accent, activeMatchColorOverviewRuler: P.palette().accent } });
$('#searchInput').addEventListener('input', () => P.active?.search.findNext($('#searchInput').value, { incremental: true, ...findOpts() }));
$('#searchInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSearch();
  else if (e.key === 'Enter') { e.preventDefault(); P.active?.search[e.shiftKey ? 'findPrevious' : 'findNext']($('#searchInput').value, findOpts()); }
});
$('#searchNext').addEventListener('click', () => P.active?.search.findNext($('#searchInput').value, findOpts()));
$('#searchPrev').addEventListener('click', () => P.active?.search.findPrevious($('#searchInput').value, findOpts()));
$('#searchClose').addEventListener('click', closeSearch);

// ---------- messages from the shell and the app ----------
function handleMsg(data) {
  const i = data.indexOf(';'), cmd = i < 0 ? data : data.slice(0, i), arg = i < 0 ? '' : data.slice(i + 1).trim();
  if (cmd === 'panel') P.openSettings(arg);
  else if (cmd === 'scheme') {
    const id = arg.toLowerCase().replace(/\s+/g, '-');
    if (SCHEMES[id]) P.set({ terminal: { scheme: id } }); else P.toast('Schemes: ' + Object.keys(SCHEMES).join(', '));
  }
}
api.onShellMsg(handleMsg);
api.onToast(P.toast);
let chipT;
api.onTranslated(({ to, dialects }) => {
  const el = $('#translated');
  el.innerHTML = `<b>${esc((dialects || []).join(' + ') || 'translated')} → PowerShell</b>${esc(to.replace(/\s+/g, ' '))}`;
  el.classList.add('show');
  clearTimeout(chipT); chipT = setTimeout(() => el.classList.remove('show'), 3500);
});
api.onAppCommand(c => { if (c.startsWith('settings')) P.openSettings(c.slice(9)); else P.newTab(); });
api.onConfig(C => { P.C = C; P.cfg = C.config; applyLook(); P.emit('config'); });

// ---------- window ----------
$('#wc').addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) api.win(b.dataset.w); });
$('.drag').addEventListener('dblclick', () => api.win('max'));
$('#gear').addEventListener('click', () => P.toggleSettings());
api.onWinState(m => document.body.classList.toggle('maxed', m));
api.onData(({ id, data }) => P.tabs.find(t => t.id === id)?.term.write(data));
api.onExit(({ id }) => closeTab(P.tabs.find(t => t.id === id), true));
api.onOpenTab(req => P.newTab(null, req.cwd || null, req));
api.onAdmin(({ id, on }) => { const t = P.tabs.find(x => x.id === id); if (t) { t.admin = on; renderTabs(); } });

api.init().then(async C => {
  P.C = C; P.cfg = C.config; P.profiles = C.profiles; P.translateAvailable = C.translateAvailable; P.version = C.version; P.elevated = C.elevated; P.platform = C.platform;
  $('#profiles').innerHTML = P.profiles.map(p => `<button data-id="${esc(p.id)}">${esc(p.name)}<small>${p.prism ? 'PowerShell + Linux commands' : p.kind === 'other' ? '' : esc(p.kind)}</small></button>`).join('');
  applyLook();
  const first = C.startup.open;
  await P.newTab(null, first?.cwd || null, first || {});
  if (C.startup.openSettings) P.openSettings(typeof C.startup.openSettings === 'string' ? C.startup.openSettings : '');
  if (C.error) P.toast(C.error);
});
}
