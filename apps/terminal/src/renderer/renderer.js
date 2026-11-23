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
const BUILTIN = { ...SCHEMES };
// schemes from your themes folder, the theme store and plugins join the built-in ones
function mergeThemes(extra) { for (const k of Object.keys(SCHEMES)) if (!BUILTIN[k]) delete SCHEMES[k]; Object.assign(SCHEMES, extra || {}, BUILTIN); }

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
  for (const p of P.panes()) Object.assign(p.term.options, termOptions());
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
  const keyOk = ek === k.key || (k.key === '=' && ek === '+') || (k.key === 'plus' && ek === '+') || (k.key === '-' && ek === '_') || (k.key === 'tab' && ek === 'tab')
    || ({ left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown' }[k.key] === ek);
  return keyOk && e.ctrlKey === k.ctrl && e.shiftKey === k.shift && e.altKey === k.alt && e.metaKey === k.meta;
};

// ---------- tabs and panes ----------
// A tab holds one or more panes (split right / down). Each pane is a terminal with its own shell or program.
// P.active is the focused pane, P.tab the visible tab. Pane ids are the ids of their shells in Prism.
P.tab = null;
P.panes = () => P.tabs.flatMap(t => t.panes);
P.paneById = id => P.panes().find(p => p.id === id);
const winBuild = () => Number(String(P.C?.osRelease || '').split('.')[2]) || 22621;
function fitTab(tab) { if (tab) for (const p of tab.panes) { try { p.fit.fit(); } catch {} } }
function fitActive() { fitTab(P.tab); }

function makePane(tab, id) {
  const el = document.createElement('div');
  el.className = 'term pane';
  const term = new Terminal({
    ...termOptions(), allowTransparency: true, macOptionIsMeta: true, allowProposedApi: true,
    // ConPTY repaints the screen itself after a resize; xterm must not reflow on top of that (duplicated lines)
    ...(P.platform === 'win32' ? { windowsPty: { backend: 'conpty', buildNumber: winBuild() } } : {})
  });
  const fit = new FitAddon.FitAddon(), search = new SearchAddon.SearchAddon();
  term.loadAddon(fit); term.loadAddon(search);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => api.openExternal(uri)));
  const pane = { id: id || crypto.randomUUID(), term, fit, search, el, tab, title: '…', profile: null, admin: false };
  tab.view.appendChild(el); // xterm measures the font when it opens, so it must be in the page (layout() moves it)
  term.open(el);
  term.onData(d => api.write(pane.id, d));
  // while the window is being resized, only the last size reaches the shell (each resize makes ConPTY repaint)
  term.onResize(({ cols, rows }) => { clearTimeout(pane.rt); pane.rt = setTimeout(() => api.resize(pane.id, cols, rows), 120); });
  term.onTitleChange(s => { pane.title = cleanTitle(s) || pane.profile?.name || 'shell'; renderTabs(); });
  term.onSelectionChange(() => { if (P.cfg.terminal.copyOnSelect && term.hasSelection()) api.clipWrite(term.getSelection()); });
  term.parser.registerOscHandler(7777, d => { handleMsg(d); return true; });
  term.attachCustomKeyEventHandler(e => keys(e, pane));
  el.addEventListener('focusin', () => { if (pane.tab.focus !== pane || P.active !== pane) focusPane(pane, false); });
  el.addEventListener('mousedown', () => { if (P.active !== pane) focusPane(pane); });
  P.emit('pane', pane); // extensions (images, widgets) hook into new panes here
  return pane;
}
// starts the shell (or program, or handed-off console) of a pane
async function startPane(pane, profileId, cwd, opts = {}) {
  if (opts.lines && opts.lines.length) {
    // the end of the previous session, dimmed, pushed into the scrollback before the new shell starts
    pane.term.write('\x1b[2m' + opts.lines.join('\r\n') + '\x1b[0m\r\n\x1b[90m── restored ' + new Date(opts.savedAt || Date.now()).toLocaleString() + ' ──\x1b[0m' + '\r\n'.repeat(pane.term.rows));
  }
  const { term } = pane;
  pane.run = opts.run || null;
  const r = opts.adopt ? await api.adopt(pane.id, term.cols, term.rows) : await api.create(pane.id, profileId, term.cols, term.rows, cwd, opts.run || null, opts.cwdFrom || opts.cwdOf || null);
  if (!r.ok && opts.adopt) { closePane(pane, true); return null; }
  pane.profile = r.profile;
  if (pane.title === '…') pane.title = opts.adopt?.title || opts.run?.title || r.profile.name;
  renderTabs(); saveSoon();
  return pane;
}
// opts: { run: { file, args, cwd, title } } runs one program; { adopt: { id, title } } shows a console Windows handed to Prism
P.newTab = async (profileId, cwd, opts = {}) => {
  const view = document.createElement('div');
  view.className = 'tabview';
  $('#terms').appendChild(view);
  const tab = { id: crypto.randomUUID(), panes: [], root: null, focus: null, view };
  const pane = makePane(tab, opts.adopt ? opts.adopt.id : null);
  if (opts.adopt || opts.run) pane.title = opts.adopt?.title || opts.run?.title;
  tab.panes.push(pane); tab.root = { pane }; tab.focus = pane;
  P.tabs.push(tab);
  layout(tab);
  activateTab(tab);
  return startPane(pane, profileId, cwd, opts);
};
// split the focused pane: dir 'row' puts the new pane on the right, 'col' below
P.split = async (dir = 'row', profileId) => {
  const src = P.active, tab = P.tab;
  if (!src || !tab) return null;
  const pane = makePane(tab);
  tab.panes.push(pane);
  replaceNode(tab, src, { dir, ratio: 0.5, a: { pane: src }, b: { pane } });
  layout(tab);
  focusPane(pane);
  const shellLike = src.profile && !['run', 'console'].includes(src.profile.kind);
  return startPane(pane, profileId || (shellLike ? src.profile.id : null), null, { cwdFrom: shellLike ? src.id : null });
};
function replaceNode(tab, pane, node) {
  const walk = n => {
    if (n.pane === pane) return node;
    if (n.a) { n.a = walk(n.a); n.b = walk(n.b); }
    return n;
  };
  tab.root = walk(tab.root);
}
function removeFromTree(tab, pane) {
  const walk = n => {
    if (!n.a) return n.pane === pane ? null : n;
    const a = walk(n.a), b = walk(n.b);
    if (!a) return b; if (!b) return a;
    n.a = a; n.b = b; return n;
  };
  tab.root = walk(tab.root);
}
// builds the pane layout of a tab: nested rows/columns with draggable dividers
function layout(tab) {
  const build = n => {
    if (n.pane) return n.pane.el;
    const box = document.createElement('div');
    box.className = `split ${n.dir}`;
    const a = build(n.a), b = build(n.b), bar = document.createElement('div');
    bar.className = 'divider';
    a.style.flex = `${n.ratio} 1 0`; b.style.flex = `${1 - n.ratio} 1 0`;
    bar.addEventListener('pointerdown', e => {
      e.preventDefault(); bar.setPointerCapture(e.pointerId);
      const r = box.getBoundingClientRect();
      const move = ev => {
        const v = n.dir === 'row' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
        n.ratio = Math.min(0.9, Math.max(0.1, v));
        a.style.flex = `${n.ratio} 1 0`; b.style.flex = `${1 - n.ratio} 1 0`;
        fitTab(tab);
      };
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); saveSoon(); };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
    });
    box.append(a, bar, b);
    return box;
  };
  tab.view.replaceChildren(build(tab.root));
  tab.view.classList.toggle('multi', tab.panes.length > 1);
  requestAnimationFrame(() => fitTab(tab));
}
// "C:\WINDOWS\system32\cmd.exe - doskey ..." and "Administrator: ..." are noisy; keep the useful part
const cleanTitle = s => String(s || '').replace(/^Administrator:\s*/, '').replace(/^.*\\(cmd|powershell|pwsh)\.exe( - .*)?$/i, '$1').slice(0, 60);
function activateTab(tab) {
  P.tab = tab;
  for (const x of P.tabs) x.view.classList.toggle('on', x === tab);
  focusPane(tab.focus || tab.panes[0]);
}
function focusPane(pane, takeFocus = true) {
  if (!pane) return;
  const tab = pane.tab;
  tab.focus = pane; P.active = pane;
  if (P.tab !== tab) { P.tab = tab; for (const x of P.tabs) x.view.classList.toggle('on', x === tab); }
  for (const p of tab.panes) p.el.classList.toggle('focused', p === pane);
  renderTabs();
  requestAnimationFrame(() => { fitTab(tab); if (takeFocus && $('#settings').hidden) pane.term.focus(); });
}
function closePane(pane, fromExit) {
  if (!pane) return;
  const tab = pane.tab;
  if (!fromExit) api.kill(pane.id);
  clearTimeout(pane.rt);
  P.emit('pane-closed', pane);
  pane.term.dispose(); pane.el.remove();
  tab.panes.splice(tab.panes.indexOf(pane), 1);
  if (!tab.panes.length) return closeTab(tab, true);
  removeFromTree(tab, pane);
  if (tab.focus === pane) tab.focus = tab.panes[tab.panes.length - 1];
  layout(tab);
  if (P.tab === tab) focusPane(tab.focus); else renderTabs();
  saveSoon();
}
function closeTab(tab, panesGone) {
  if (!tab) return;
  if (!panesGone) for (const p of tab.panes.splice(0)) { api.kill(p.id); clearTimeout(p.rt); P.emit('pane-closed', p); p.term.dispose(); }
  tab.view.remove();
  const i = P.tabs.indexOf(tab);
  P.tabs.splice(i, 1);
  if (!P.tabs.length) { api.saveSession({ tabs: [] }, true); return api.win('close'); }
  if (P.tab === tab) activateTab(P.tabs[Math.min(i, P.tabs.length - 1)]); else renderTabs();
  saveSoon();
}
// move the focus to the pane next to this one (dir: left, right, up, down)
function paneNeighbor(pane, dir) {
  const r = pane.el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bestD = Infinity;
  for (const p of pane.tab.panes) {
    if (p === pane) continue;
    const q = p.el.getBoundingClientRect(), qx = q.left + q.width / 2, qy = q.top + q.height / 2;
    const ok = dir === 'left' ? q.right <= r.left + 2 : dir === 'right' ? q.left >= r.right - 2 : dir === 'up' ? q.bottom <= r.top + 2 : q.top >= r.bottom - 2;
    if (!ok) continue;
    const d = Math.hypot(qx - cx, qy - cy);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}
function resizePane(pane, dir) {
  // grow the focused pane towards dir, by changing the nearest split in that direction
  const want = dir === 'left' || dir === 'right' ? 'row' : 'col', step = dir === 'right' || dir === 'down' ? 0.05 : -0.05;
  const path = [];
  const find = n => { if (n.pane) return n.pane === pane; path.push(n); if (find(n.a) || find(n.b)) return true; path.pop(); return false; };
  find(pane.tab.root);
  const split = path.reverse().find(n => n.dir === want);
  if (!split) return;
  split.ratio = Math.min(0.9, Math.max(0.1, split.ratio + step));
  layout(pane.tab); saveSoon();
}
function renderTabs() {
  $('#tabs').innerHTML = P.tabs.map((t, i) => {
    const f = t.focus || t.panes[0], admin = t.panes.some(p => p.admin) || P.elevated, title = f ? f.title : '…';
    const pg = t.panes.map(p => p.progress).find(Boolean); // progress reported by a program (Prism API)
    return `<button class="tab${t === P.tab ? ' on' : ''}${admin ? ' admin' : ''}" data-i="${i}" title="${esc(title)}${admin && !P.elevated ? ' (running as administrator)' : ''}">${admin ? '<span class="sh" aria-label="administrator">⚡</span>' : ''}<span class="t">${esc(title)}</span>${t.panes.length > 1 ? `<span class="np" title="${t.panes.length} panes">${t.panes.length}</span>` : ''}<span class="x" data-x="${i}" aria-label="Close tab">×</span>${pg ? `<i class="pg ${pg.state}" style="width:${pg.value}%"></i>` : ''}</button>`;
  }).join('');
}
P.renderTabs = renderTabs;
P.typeInActive = text => { if (!P.active) return; P.closeSettings?.(); api.write(P.active.id, text); P.active.term.focus(); };
$('#tabs').addEventListener('mousedown', e => {
  const x = e.target.closest('[data-x]'), b = e.target.closest('.tab');
  if (!b) return;
  const t = P.tabs[+(x || b).dataset[x ? 'x' : 'i']];
  if (x || e.button === 1) { e.preventDefault(); closeTab(t); } else { P.closeSettings?.(); activateTab(t); }
});
$('#add').addEventListener('click', () => P.newTab());
$('#addMenu').addEventListener('click', e => { e.stopPropagation(); renderProfilesMenu(); $('#profiles').hidden = !$('#profiles').hidden; });
$('#profiles').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $('#profiles').hidden = true;
  if (b.dataset.split) P.split(b.dataset.split);
  else if (b.dataset.ssh) P.openSsh?.(b.dataset.ssh);
  else P.newTab(b.dataset.id);
});
document.addEventListener('click', e => { if (!e.target.closest('.newtab')) $('#profiles').hidden = true; });
$('#logo').addEventListener('click', () => api.menu());
// saved SSH servers (Settings > SSH) open in a new tab
P.openSsh = name => {
  const h = ((P.cfg.ssh || {}).hosts || []).find(x => x.name === name); if (!h) return;
  const args = [];
  if (h.port && +h.port !== 22) args.push('-p', String(h.port));
  if (h.identityFile) args.push('-i', h.identityFile);
  args.push((h.user ? h.user + '@' : '') + h.host);
  return P.newTab(null, null, { run: { file: 'ssh.exe', args, title: h.name, ssh: h.name } });
};
new ResizeObserver(fitActive).observe($('#terms'));
function renderProfilesMenu() {
  const ssh = (P.cfg.ssh && P.cfg.ssh.hosts) || [];
  $('#profiles').innerHTML = P.profiles.map(p => `<button data-id="${esc(p.id)}">${esc(p.name)}<small>${p.prism ? 'PowerShell + Linux commands' : p.kind === 'other' ? '' : esc(p.kind)}</small></button>`).join('')
    + (ssh.length ? '<hr>' + ssh.map(h => `<button data-ssh="${esc(h.name)}">${esc(h.name)}<small>ssh ${esc(h.user ? h.user + '@' : '')}${esc(h.host)}</small></button>`).join('') : '')
    + `<hr><button data-split="row">Split right<small>${esc(P.cfg.keys.splitRight || '')}</small></button><button data-split="col">Split down<small>${esc(P.cfg.keys.splitDown || '')}</small></button>`;
}

// ---------- session (tabs come back after a restart) ----------
function lastLines(pane, n = 400) {
  const b = pane.term.buffer.active, end = b.baseY + b.cursorY, out = [];
  for (let i = Math.max(0, end - n); i <= end; i++) out.push(b.getLine(i)?.translateToString(true) ?? '');
  while (out.length && !out[out.length - 1].trim()) out.pop();
  // the prompt the shell was waiting at is not useful in the restored text
  if (out.length) out.pop();
  return out;
}
function snapshot() {
  const ser = n => n.pane ? { pane: n.pane.id, profile: n.pane.profile && !['run', 'console'].includes(n.pane.profile.kind) ? n.pane.profile.id : null, ssh: n.pane.run && n.pane.run.ssh ? n.pane.run : null, lines: lastLines(n.pane) }
    : { dir: n.dir, ratio: n.ratio, a: ser(n.a), b: ser(n.b) };
  return { savedAt: Date.now(), active: P.tabs.indexOf(P.tab), tabs: P.tabs.map(t => ({ root: ser(t.root), focus: t.panes.indexOf(t.focus) })) };
}
P.snapshot = snapshot;
let saveT;
function saveSoon() { clearTimeout(saveT); saveT = setTimeout(() => { if (P.tabs.length) api.saveSession(snapshot()); }, 1500); }
setInterval(() => { if (P.tabs.length) api.saveSession(snapshot()); }, 20000);
window.addEventListener('beforeunload', () => { if (P.tabs.length) api.saveSession(snapshot(), true); });
async function restore(s) {
  const build = async (n, tab) => {
    if (n.pane) {
      const pane = makePane(tab);
      tab.panes.push(pane);
      pane.restore = n;
      return { pane };
    }
    return { dir: n.dir, ratio: n.ratio, a: await build(n.a, tab), b: await build(n.b, tab) };
  };
  for (const t of s.tabs || []) {
    const view = document.createElement('div');
    view.className = 'tabview';
    $('#terms').appendChild(view);
    const tab = { id: crypto.randomUUID(), panes: [], root: null, focus: null, view };
    tab.root = await build(t.root, tab);
    tab.focus = tab.panes[t.focus] || tab.panes[0];
    P.tabs.push(tab);
    layout(tab);
  }
  if (!P.tabs.length) return false;
  activateTab(P.tabs[s.active] || P.tabs[0]);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (const tab of P.tabs) {
    fitTab(tab); // hidden tabs keep their layout, so they can be measured too
    for (const p of tab.panes) startPane(p, p.restore.profile, null, { cwdOf: p.restore.pane, lines: p.restore.lines, savedAt: s.savedAt, run: p.restore.ssh || null });
  }
  return true;
}

// ---------- keyboard ----------
function keys(e, t) {
  if (e.type !== 'keydown') return true;
  if (t.widgetKeys) { e.preventDefault(); return t.widgetKeys(e); } // buttons shown by a program take the keys
  const K = P.cfg.keys, stop = () => { e.preventDefault(); return false; };
  if (keyMatch(e, K.newTab) || (MAC && e.metaKey && e.key === 't')) { P.newTab(); return stop(); }
  if (keyMatch(e, K.closeTab) || (MAC && e.metaKey && e.key === 'w')) { closePane(t); return stop(); }
  if (keyMatch(e, K.splitRight)) { P.split('row'); return stop(); }
  if (keyMatch(e, K.splitDown)) { P.split('col'); return stop(); }
  for (const d of ['Left', 'Right', 'Up', 'Down']) {
    if (keyMatch(e, K['focus' + d])) { const n = paneNeighbor(t, d.toLowerCase()); if (n) focusPane(n); return stop(); }
    if (keyMatch(e, K['resize' + d])) { resizePane(t, d.toLowerCase()); return stop(); }
  }
  if (keyMatch(e, K.newWindow)) { api.win('new'); return stop(); }
  if (keyMatch(e, K.nextTab)) { const i = P.tabs.indexOf(t.tab); activateTab(P.tabs[(i + 1) % P.tabs.length]); return stop(); }
  if (keyMatch(e, K.prevTab)) { const i = P.tabs.indexOf(t.tab); activateTab(P.tabs[(i - 1 + P.tabs.length) % P.tabs.length]); return stop(); }
  if (e.altKey && !e.ctrlKey && !e.shiftKey && /^[1-9]$/.test(e.key) && P.tabs[+e.key - 1]) { activateTab(P.tabs[+e.key - 1]); return stop(); }
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
  const el = e.target.closest('.term'), pane = el && P.panes().find(p => p.el === el);
  if (pane && pane !== P.active) focusPane(pane);
  if (!P.active || !el) return;
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
api.onAppCommand(c => { if (c.startsWith('settings')) P.openSettings(c.slice(9)); else if (c === 'split-right') P.split('row'); else if (c === 'split-down') P.split('col'); else P.newTab(); });
api.onConfig(C => { P.C = C; P.cfg = C.config; mergeThemes(C.themes); applyLook(); P.emit('config'); });

// ---------- window ----------
$('#wc').addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) api.win(b.dataset.w); });
$('.drag').addEventListener('dblclick', () => api.win('max'));
$('#gear').addEventListener('click', () => P.toggleSettings());
api.onWinState(m => document.body.classList.toggle('maxed', m));
// resizing from the edges: the pointer stays captured, so dragging outside the window keeps working
document.querySelectorAll('.rz i').forEach(h => h.addEventListener('pointerdown', async e => {
  if (e.button !== 0) return;
  e.preventDefault();
  h.setPointerCapture(e.pointerId);
  const edge = h.dataset.e, x0 = e.screenX, y0 = e.screenY;
  await api.resizeStart();
  let raf = 0, last = null;
  const move = ev => { last = ev; if (!raf) raf = requestAnimationFrame(() => { raf = 0; api.resizeTo(edge, last.screenX - x0, last.screenY - y0); }); };
  const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('lostpointercapture', up); if (last) api.resizeTo(edge, last.screenX - x0, last.screenY - y0); };
  h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('lostpointercapture', up);
}));
api.onData(({ id, data }) => { const p = P.paneById(id); if (p) { p.lastData = Date.now(); p.term.write(data); } });
api.onExit(({ id }) => closePane(P.paneById(id), true));
api.onOpenTab(req => P.newTab(null, req.cwd || null, req));
api.onAdmin(({ id, on }) => { const p = P.paneById(id); if (p) { p.admin = on; renderTabs(); } });

api.init().then(async C => {
  P.C = C; P.cfg = C.config; P.profiles = C.profiles; P.translateAvailable = C.translateAvailable; P.version = C.version; P.elevated = C.elevated; P.platform = C.platform;
  mergeThemes(C.themes);
  applyLook();
  const first = C.startup.open;
  if (!(C.startup.restore && !first && await restore(C.startup.restore))) await P.newTab(null, first?.cwd || null, first || {});
  if (C.startup.openSettings) P.openSettings(typeof C.startup.openSettings === 'string' ? C.startup.openSettings : '');
  if (C.error) P.toast(C.error);
});
}
