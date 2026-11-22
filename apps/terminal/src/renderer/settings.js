'use strict';
// Prism settings, opened with `settings` in the terminal (or Ctrl+,). Everything works with the mouse.
// Desktop themes are edited as a draft and applied with one button; everything else applies live
// and is saved to the settings layer. Values set in ~/.config/prism/config.jsonc win and are marked.
{
const P = window.Prism, { api, $, esc, hexA } = P;
const HEX = /^#[0-9a-f]{6}$/i;
const clone = o => JSON.parse(JSON.stringify(o));
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function set(o, p, v) { const ks = p.split('.'); let c = o; for (const k of ks.slice(0, -1)) { if (c[k] == null || typeof c[k] !== 'object') c[k] = {}; c = c[k]; } c[ks[ks.length - 1]] = v; }
const patchOf = (p, v) => { const o = {}; set(o, p, v); return o; };

const ICON = {
  themes: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.3"/><circle cx="12" cy="7.5" r="1.3"/><circle cx="15.5" cy="10" r="1.3"/><path d="M12 21a2.5 2.5 0 0 1 0-5h2a3 3 0 0 0 3-3"/>',
  colors: '<path d="M12 3c3.2 4 6 7.2 6 11a6 6 0 0 1-12 0c0-3.8 2.8-7 6-11z"/>',
  wallpaper: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>',
  windows: '<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>',
  dock: '<rect x="3" y="15" width="18" height="5" rx="2.5"/><path d="M7.5 17.5h.01M12 17.5h.01M16.5 17.5h.01M5 4h14v8H5z"/>',
  bar: '<rect x="3" y="4" width="18" height="4" rx="1.5"/><path d="M5 12h14v8H5z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12.5 15H17"/>',
  shell: '<path d="M4 17l6-5-6-5M12 19h8"/>',
  aliases: '<path d="M9 5H7a2 2 0 0 0-2 2v3l-2 2 2 2v3a2 2 0 0 0 2 2h2M15 5h2a2 2 0 0 1 2 2v3l2 2-2 2v3a2 2 0 0 1-2 2h-2"/>',
  keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  files: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/>'
};
const SECTIONS = [
  { id: 'themes', name: 'Themes', sub: 'Complete desktop looks: colors, wallpaper, window tiling, dock and menu bar. Pick one, tweak it, apply it.', pv: 'desk', group: 'Desktop' },
  { id: 'colors', name: 'Colors', sub: 'The palette of the theme you are editing. Used by Windows, window borders, the wallpaper and the terminal.', pv: 'desk' },
  { id: 'wallpaper', name: 'Wallpaper', sub: 'A gradient made from any colors, or your own picture.', pv: 'desk' },
  { id: 'windows', name: 'Windows', sub: 'Tiling, gaps, borders and corners (powered by GlazeWM).', pv: 'desk' },
  { id: 'dock', name: 'Dock', sub: 'A macOS-style dock for pinned and running apps. Changes apply immediately.', pv: null },
  { id: 'bar', name: 'Menu bar', sub: 'A top bar with workspaces, the active app, clock and system stats. Changes apply immediately.', pv: null },
  { id: 'terminal', name: 'Terminal', sub: 'How this window looks. Changes apply immediately.', pv: 'term', group: 'Terminal' },
  { id: 'shell', name: 'Shell & prompt', sub: 'Default shell, command translation, Linux commands and the prompt.', pv: 'prompt' },
  { id: 'aliases', name: 'Aliases', sub: 'Your own commands. They work in every shell, with arguments and pipes.', pv: null },
  { id: 'keys', name: 'Keyboard', sub: 'Shortcuts. Click a field and press the keys you want.', pv: null },
  { id: 'files', name: 'Config files', sub: 'Prefer text files? Everything here can be set in config.jsonc and styled with style.css. They reload when you save.', pv: null, group: 'Prism' },
  { id: 'about', name: 'About', sub: '', pv: null }
];
P.sectionIds = SECTIONS.map(s => s.id);
const SEC = id => SECTIONS.find(s => s.id === id);
const ALIAS = { theme: 'themes', look: 'terminal', cmd: 'aliases', commands: 'aliases', alias: 'aliases', prompt: 'shell', menubar: 'bar', 'menu-bar': 'bar', tiling: 'windows', config: 'files', keyboard: 'keys', shortcuts: 'keys' };
const COLOR_NAMES = { background: 'Background', surface: 'Surface', text: 'Text', muted: 'Muted text', accent: 'Accent', accent2: 'Second accent' };
const COLOR_HINTS = { background: 'terminal, wallpaper, windows', surface: 'bars, cards, inactive borders', text: 'main text', muted: 'labels, secondary text', accent: 'Windows accent, active border, cursor', accent2: 'highlights, wallpaper, prompt' };
const DEF = { 'effects.transparency': true, 'effects.opacity': 84, 'effects.blur': true, 'effects.radius': 12, 'fonts.mono': 'Cascadia Code', 'fonts.size': 14,
  'wallpaper.type': 'gradient', 'wallpaper.angle': 120, 'windows.tiling': false, 'windows.gaps.inner': 10, 'windows.gaps.outer': 12, 'windows.border.enabled': true,
  'windows.border.focused': 'accent', 'windows.border.inactive': 'surface', 'windows.corners': 'rounded', 'windows.hideTitleBar': false, 'windows.inactiveOpacity': 100,
  'taskbar.alignment': 'center' };
const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const SEGMENTS = { userhost: 'user@host', path: 'Folder', git: 'Git branch', venv: 'Python venv', duration: 'Command time', status: 'Exit status', time: 'Clock', shell: 'Shell name' };
const MODULES = { menu: 'Prism menu', workspaces: 'Workspaces', app: 'Active app', clock: 'Clock', date: 'Date', cpu: 'CPU', memory: 'Memory', battery: 'Battery', network: 'Network' };
const KEYS = { newTab: 'New tab', closeTab: 'Close tab', nextTab: 'Next tab', prevTab: 'Previous tab', newWindow: 'New window', settings: 'Settings', search: 'Find', copy: 'Copy', paste: 'Paste', zoomIn: 'Bigger text', zoomOut: 'Smaller text', zoomReset: 'Reset text size', toggleWindow: 'Show/hide Prism from anywhere' };

const st = { section: 'themes', themes: [], sel: null, draft: null, dirty: false, state: null, busy: false, log: '', logOpen: false, editing: null, running: [] };
const over = p => (P.C.overridden || []).some(o => o === p || o.startsWith(p + '.') || p.startsWith(o + '.'));
const dget = p => { const v = get(st.draft, p); return v === undefined ? DEF[p] : v; };
const color = (t, v, fb) => HEX.test(v || '') ? v : (HEX.test(t?.colors?.[v] || '') ? t.colors[v] : fb);
function setDraft(p, v) { set(st.draft, p, v); st.dirty = true; updatePreview(); }
let liveT = null;
function setLive(p, v, now) {
  set(P.cfg, p, v); // optimistic, so the preview updates at once
  clearTimeout(liveT);
  const send = () => P.set(patchOf(p, v));
  if (now) send(); else liveT = setTimeout(send, 140);
  updatePreview();
}

// ---------- open / close ----------
P.openSettings = async sec => {
  const el = $('#settings'), was = el.hidden;
  el.hidden = false;
  if (was || !st.themes.length) await loadThemes();
  const s = String(sec || '').trim().toLowerCase();
  go(ALIAS[s] || (SEC(s) ? s : was ? 'themes' : st.section));
};
P.closeSettings = () => { if ($('#settings').hidden) return; $('#settings').hidden = true; P.active?.term.focus(); };
P.toggleSettings = () => ($('#settings').hidden ? P.openSettings() : P.closeSettings());
P.goSection = s => go(s);

async function loadThemes() {
  [st.themes, st.state] = await Promise.all([api.themes.list(), api.prismState()]);
  if (!st.draft || (!st.dirty && !st.themes.some(t => t.id === st.sel))) {
    const cur = st.state.current?.id;
    select((st.themes.find(t => t.id === cur) || st.themes.find(t => t.id === st.sel) || st.themes[0])?.id);
  }
}
function select(id) {
  const t = st.themes.find(x => x.id === id);
  st.sel = t ? t.id : null;
  st.draft = t ? clone(t.theme) : { id: 'my-theme', name: 'My theme', colors: { mode: 'dark', background: '#101216', surface: '#1a1d24', text: '#e7e5df', muted: '#8a8a90', accent: '#7aa7ff', accent2: '#ff9f7a' } };
  st.dirty = false;
}

// ---------- render ----------
function go(sec) {
  st.section = SEC(sec) ? sec : 'themes';
  const s = SEC(st.section);
  let nav = '';
  for (const x of SECTIONS) {
    if (x.group) nav += `<div class="ng">${x.group}</div>`;
    nav += `<button class="nb${x.id === st.section ? ' on' : ''}" data-s="${x.id}"><svg viewBox="0 0 24 24">${ICON[x.id]}</svg>${x.name}</button>`;
  }
  $('#sNav').innerHTML = nav + '<div class="hint"><kbd>Esc</kbd> back to the terminal</div>';
  $('#sTitle').textContent = s.name;
  $('#sSub').textContent = s.id === 'about' ? `Version ${P.version}` : s.sub;
  $('#settings').classList.toggle('nopv', !s.pv);
  $('#sNote').innerHTML = P.C.error ? `<div class="notice err">${esc(P.C.error)}</div>` : '';
  renderSection();
  renderPreview();
  $('#sMain').scrollTop = 0;
}
function renderSection() {
  const R = { themes: secThemes, colors: secColors, wallpaper: secWallpaper, windows: secWindows, dock: secDock, bar: secBar, terminal: secTerminal, shell: secShell, aliases: secAliases, keys: secKeys, files: secFiles, about: secAbout };
  $('#sContent').innerHTML = R[st.section]();
}

// ---------- controls (data-d = theme draft, data-c = live config) ----------
const group = (title, body) => `<div class="group">${title ? `<h3>${title}</h3>` : ''}${body}</div>`;
const label = (t, hint) => `<span>${t}${hint ? `<small>${hint}</small>` : ''}</span>`;
const lock = p => over(p) ? ' <em class="lock" title="Set in config.jsonc, which wins over Settings">config.jsonc</em>' : '';
const val = (attr, p) => attr === 'data-c' ? get(P.cfg, p) : dget(p);
const dis = (attr, p) => attr === 'data-c' && over(p) ? 'disabled' : '';
const toggle = (attr, p, t, hint) => `<label class="row">${label(t + (attr === 'data-c' ? lock(p) : ''), hint)}<span class="sw-t"><input type="checkbox" ${attr}="${p}" data-re="1" ${val(attr, p) ? 'checked' : ''} ${dis(attr, p)}><i></i></span></label>`;
const fmt = (v, step) => step < 1 ? (+v).toFixed(2) : v;
const range = (attr, p, t, min, max, unit, step = 1, hint) => {
  const v = val(attr, p);
  return `<div class="field">${label(t + (attr === 'data-c' ? lock(p) : ''), hint)}<div class="range"><input type="range" ${attr}="${p}" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${esc(t)}" ${dis(attr, p)}><output data-out="${p}" data-unit="${unit}">${fmt(v, step)}${unit}</output></div></div>`;
};
const seg = (attr, p, opts, t) => {
  const v = val(attr, p);
  const inner = `<div class="seg" role="radiogroup">${opts.map(([k, l]) => `<button ${attr === 'data-c' ? 'data-cseg' : 'data-seg'}="${p}" data-v="${esc(k)}" class="${String(v) === String(k) ? 'on' : ''}" role="radio" aria-checked="${String(v) === String(k)}" ${dis(attr, p)}>${l}</button>`).join('')}</div>`;
  return t ? `<div class="field"><span>${t}${attr === 'data-c' ? lock(p) : ''}</span>${inner}</div>` : inner;
};
const text = (attr, p, t, hint, ph = '') => `<div class="field">${label(t + (attr === 'data-c' ? lock(p) : ''), hint)}<input type="text" ${attr}="${p}" value="${esc(val(attr, p) ?? '')}" placeholder="${esc(ph)}" spellcheck="false" ${dis(attr, p)}></div>`;
const colorRow = (attr, p, t, hint, value) => {
  const v = (value !== undefined ? value : val(attr, p)) || '#000000';
  return `<label class="crow"><input type="color" ${attr}="${p}" value="${v}" aria-label="${esc(t)}" ${dis(attr, p)}><span><b>${t}</b><small>${hint || ''}</small></span><input class="hex" ${attr}="${p}" value="${v}" maxlength="7" spellcheck="false" aria-label="${esc(t)} hex" ${dis(attr, p)}></label>`;
};
const refSel = (p, t) => {
  const v = dget(p);
  return `<div class="field"><span>${t}</span><div class="refsel">${Object.keys(COLOR_NAMES).filter(n => st.draft.colors[n]).map(n =>
    `<button class="swb${v === n ? ' on' : ''}" data-seg="${p}" data-v="${n}" title="${COLOR_NAMES[n]}" aria-label="${COLOR_NAMES[n]}" style="background:${st.draft.colors[n]}"></button>`).join('')}
    <input type="color" data-d="${p}" value="${color(st.draft, v, '#888888')}" title="Custom color" aria-label="Custom color"></div></div>`;
};
const chips = (p, all, selected) => `<div class="chips">${Object.entries(all).map(([k, l]) => `<button class="chip${selected.includes(k) ? ' on' : ''}" data-chips="${p}" data-v="${k}" ${over(p) ? 'disabled' : ''}>${selected.includes(k) ? `<i>${selected.indexOf(k) + 1}</i>` : ''}${l}</button>`).join('')}</div>`;

// ---------- desktop theme sections ----------
function secThemes() {
  const cur = st.state?.current?.id;
  const cards = st.themes.map(t => `<button class="tcard${t.id === st.sel ? ' on' : ''}" data-theme="${esc(t.id)}">
      ${desk(t.id === st.sel && st.dirty ? st.draft : t.theme, true)}
      <div class="tm"><b>${esc(t.theme.name)}</b>${t.id === cur ? '<span class="badge ok">Active</span>' : ''}${t.builtIn ? '' : '<span class="badge">Yours</span>'}</div>
      <p>${esc(t.theme.description || '')}</p></button>`).join('');
  const meta = st.themes.find(t => t.id === st.sel);
  return `<div class="cards">${cards}<button class="tcard new" data-new><b>+</b>New theme<small>starts from the selected one</small></button></div>
    ${group('Windows', `<p class="note">The first time you apply a theme, Prism saves a backup of everything it changes. This button puts it all back.</p>
      <div class="btns"><button class="btn ghost danger" data-restore ${st.state?.hasBackup && !st.busy ? '' : 'disabled'}>Restore original Windows look</button>
        ${meta && !meta.builtIn ? `<button class="btn ghost" data-deltheme>Delete “${esc(meta.theme.name)}”</button>` : ''}</div>
      ${st.state && !st.state.win11 ? '<p class="note warn">Desktop themes need Windows 11. You can still create and save themes here.</p>' : ''}`)}`;
}
function secColors() {
  return group('Mode', seg('data-d', 'colors.mode', [['dark', 'Dark'], ['light', 'Light']]) + '<p class="note">Windows and app mode.</p>')
    + group('Palette', `<div class="crows">${Object.keys(COLOR_NAMES).map(k => colorRow('data-d', 'colors.' + k, COLOR_NAMES[k], COLOR_HINTS[k])).join('')}</div>
      <div class="btns"><button class="btn ghost" data-harmony>Match the rest to the accent</button></div>`)
    + group('Effects', toggle('data-d', 'effects.transparency', 'Windows transparency', 'Taskbar, Start menu and system windows show through.')
      + range('data-d', 'effects.opacity', 'Terminal opacity', 0, 100, '%')
      + toggle('data-d', 'effects.blur', 'Blur behind the terminal', 'Takes effect when a new Prism window opens.')
      + range('data-d', 'effects.radius', 'Terminal corner radius', 0, 24, ' px'))
    + group('Terminal font', `<div class="field">${label('Font name', 'Must be installed, e.g. Cascadia Code, JetBrains Mono, Consolas')}<input type="text" data-d="fonts.mono" value="${esc(dget('fonts.mono'))}" spellcheck="false"></div>`
      + range('data-d', 'fonts.size', 'Size', 10, 24, ' px'));
}
function secWallpaper() {
  const type = dget('wallpaper.type');
  if (!st.draft.wallpaper) st.draft.wallpaper = { type };
  if (type === 'gradient' && (st.draft.wallpaper.colors || []).length < 2) st.draft.wallpaper.colors = [st.draft.colors.background, st.draft.colors.accent];
  let body;
  if (type === 'gradient') {
    const cols = st.draft.wallpaper.colors.map(c => color(st.draft, c, '#000000'));
    body = group('Gradient colors', `<div class="stops">${cols.map((c, i) => `<div class="stop"><input type="color" data-stop="${i}" value="${c}" aria-label="Color ${i + 1}"><input class="hex" data-stop="${i}" value="${c}" maxlength="7" aria-label="Color ${i + 1} hex"><button class="ic sm" data-rmstop="${i}" ${cols.length <= 2 ? 'disabled' : ''} aria-label="Remove color">✕</button></div>`).join('')}</div>
      <div class="btns"><button class="btn ghost" data-addstop ${cols.length >= 8 ? 'disabled' : ''}>+ Add color</button><button class="btn ghost" data-shuffle>Shuffle from palette</button></div>`)
      + group('Direction', range('data-d', 'wallpaper.angle', 'Angle', 0, 360, '°'));
  } else if (type === 'image') {
    const p = st.draft.wallpaper.path || '';
    body = group('Picture', `<div class="row">${label('File', p ? esc(p.split(/[\\/]/).pop()) : 'JPG or PNG, ideally your screen resolution')}<button class="btn ghost" data-wppick>Choose…</button></div>
      <p class="note">When you save the theme, Prism copies the picture next to it.</p>`);
  } else body = group('', '<p class="note">Prism will not change your wallpaper.</p>');
  return group('Type', seg('data-d', 'wallpaper.type', [['gradient', 'Gradient'], ['image', 'Picture'], ['none', 'Keep mine']])) + body;
}
function secWindows() {
  const tiling = dget('windows.tiling');
  return group('Layout', toggle('data-d', 'windows.tiling', 'Tile windows automatically', 'New windows sit side by side. Alt+arrows move focus, Alt+1…9 switch workspaces, Alt+Shift+E turns it off. Installs GlazeWM.')
      + (tiling ? range('data-d', 'windows.gaps.inner', 'Gap between windows', 0, 40, ' px') + range('data-d', 'windows.gaps.outer', 'Gap to screen edges', 0, 60, ' px') : ''))
    + group('Borders and corners', `${tiling ? '' : '<p class="note warn">Borders, corners, hidden title bars and window transparency come with tiling (GlazeWM). Turn it on above.</p>'}
      <div class="${tiling ? '' : 'dim'}" style="display:grid;gap:14px">
      ${toggle('data-d', 'windows.border.enabled', 'Colored window borders')}
      ${refSel('windows.border.focused', 'Active window border')}
      ${refSel('windows.border.inactive', 'Other windows')}
      ${seg('data-d', 'windows.corners', [['rounded', 'Rounded'], ['small_rounded', 'Slightly rounded'], ['square', 'Square']], 'Window corners')}
      ${toggle('data-d', 'windows.hideTitleBar', 'Hide title bars', 'A cleaner look. A few apps may draw oddly.')}
      ${range('data-d', 'windows.inactiveOpacity', 'Inactive window opacity', 30, 100, '%')}</div>`)
    + group('Windows taskbar', seg('data-d', 'taskbar.alignment', [['left', 'Left'], ['center', 'Center']], 'Taskbar icons') + '<p class="note">With the Prism dock on, the Windows taskbar hides automatically.</p>');
}

// ---------- previews ----------
function wallCss(t) {
  const wp = t.wallpaper || {}, bg = t.colors?.background || '#101216';
  if (wp.type === 'gradient' && (wp.colors || []).length > 1) return `linear-gradient(${((wp.angle ?? 90) + 90) % 360}deg, ${wp.colors.map(x => color(t, x, bg)).join(', ')})`;
  if (wp.type === 'none') return 'linear-gradient(160deg, #1d3a63, #4e78b0 55%, #9cb8d8)';
  return '';
}
function desk(t, mini) {
  const c = t.colors || {}, bg = c.background || '#101216', sf = c.surface || bg, tx = c.text || '#eee', mu = c.muted || tx, ac = c.accent || '#7aa7ff', a2 = c.accent2 || ac;
  const w = t.windows || {}, tiling = !!w.tiling, gi = w.gaps?.inner ?? 10, go_ = w.gaps?.outer ?? 12;
  const dockOn = !!t.dock?.enabled, barOn = !!t.bar?.enabled;
  const rad = ({ rounded: 8, small_rounded: 4, square: 0 }[w.corners || 'rounded'] ?? 8) * (mini ? .6 : 1);
  const bOn = tiling && w.border?.enabled !== false;
  const fb = color(t, w.border?.focused || 'accent', ac), ib = color(t, w.border?.inactive || 'surface', sf);
  const inOp = tiling ? (w.inactiveOpacity ?? 100) / 100 : 1, op = (t.effects?.opacity ?? 84) / 100;
  const W = 1920, H = 1200, TOP = barOn ? 40 : 0, BOT = dockOn ? 110 : 48, pct = (v, ref) => (v / ref * 100).toFixed(3) + '%';
  let rects;
  if (tiling) {
    const top = TOP + go_, left = go_, bottom = H - BOT - go_, right = W - go_, mid = left + (right - left - gi) / 2, half = (bottom - top - gi) / 2;
    rects = [[left, top, mid - left, bottom - top, 'term', true], [mid + gi, top, right - mid - gi, half, 'app', false], [mid + gi, top + half + gi, right - mid - gi, half, 'app2', false]];
  } else rects = [[230, 150 + TOP, 1060, 680, 'app', false], [800, 400 + TOP / 2, 880, 520, 'term', true]];
  const hide = tiling && w.hideTitleBar;
  const wins = rects.map(([x, y, ww, hh, kind, focus]) => {
    const term = kind === 'term';
    const body = term
      ? `<div class="mbody">${[[ac, tx, 46], [null, mu, 70], [null, a2, 38], [ac, tx, 24]].map(([p, col, wd]) => `<div class="ml">${p ? `<b style="color:${p}">❯</b>` : ''}<span style="background:${col};width:${wd}%"></span></div>`).join('')}</div>`
      : `<div class="mapp"><div class="side" style="background:${hexA(bg, .35)}">${[60, 80, 50, 70].map(x => `<span style="background:${mu};width:${x}%"></span>`).join('')}</div><div class="main">${[ac, a2, mu, sf].map(col => `<span style="background:${hexA(col, kind === 'app2' ? .5 : .75)}"></span>`).join('')}</div></div>`;
    return `<div class="mw" style="left:${pct(x, W)};top:${pct(y, H)};width:${pct(ww, W)};height:${pct(hh, H)};border-radius:${rad}px;border-color:${bOn ? (focus ? fb : ib) : 'rgba(255,255,255,.1)'};opacity:${focus ? 1 : inOp};background:${term ? hexA(bg, op) : c.mode === 'light' ? '#fafafa' : sf};color:${tx}">${hide ? '' : `<div class="mt" style="background:${term ? 'transparent' : hexA(bg, .25)}"><i></i><i></i><i></i></div>`}${body}</div>`;
  }).join('');
  const icons = [ac, a2, mu, tx, ac, a2].map(col => `<i style="background:${col}"></i>`).join('');
  const bottomBar = dockOn ? `<div class="mtb dock" style="background:${hexA(sf, .55)}">${icons}</div>`
    : `<div class="mtb ${t.taskbar?.alignment === 'left' ? 'left' : 'center'}" style="background:${hexA(sf, t.effects?.transparency === false ? 1 : .8)}">${icons}<span class="clock" style="color:${tx}">12:34</span></div>`;
  const topBar = barOn ? `<div class="mbar" style="background:${hexA(bg, .5)};color:${tx}"><i class="lg" style="background:${ac}"></i>${[1, 2, 3].map(n => `<i class="wsd" style="${n === 1 ? `background:${ac}` : ''}"></i>`).join('')}<span class="clk">Mon 12:34</span></div>` : '';
  const wall = wallCss(t);
  return `<div class="desk${mini ? ' mini' : ''}" style="background:${wall || '#22252c'}">${wall ? '' : '<div class="wpimg">Your picture</div>'}${topBar}${wins}${bottomBar}</div>`;
}
function termPreview() {
  const t = P.cfg.terminal, c = P.palette(), cur = `<span class="cur-${t.cursor}" style="background:${c.accent}"></span>`;
  const pr = `<span style="color:${c.blue};font-weight:700">~/projects/prism</span> <span style="color:${c.magenta}"> main</span>\n<span style="color:${c.green}">❯</span>`;
  return `<div class="tpv" style="background:${wallCss(st.draft) || '#22252c'}"><div class="tpw" style="background:${hexA(c.background, t.opacity / 100)};color:${c.foreground};font-family:${esc(t.font)};font-size:${Math.min(t.fontSize, 15)}px;line-height:${t.lineHeight};border-radius:${t.radius}px;padding:${Math.min(t.padding, 22)}px">${pr} ls -la
<span style="color:${c.brightBlack}">d---  -     Nov 22 09:41</span> <span style="color:${c.blue};font-weight:700">src</span>
<span style="color:${c.brightBlack}">-a--  2.1K  Nov 22 09:40</span> package.json
${pr} git status
<span style="color:${c.green}">On branch main</span>  <span style="color:${c.red}">modified: README.md</span>
${pr} ${cur}</div></div>`;
}
function promptPreview() {
  const p = P.cfg.prompt, c = p.colors || {}, tc = P.palette();
  const seg = s => ({ userhost: `<span style="color:${c.user}">you</span><span style="color:${c.muted}">@</span><span style="color:${c.host}">pc</span>`, path: `<b style="color:${c.path}">~/projects/prism</b>`,
    git: `<span style="color:${c.git}">${esc(p.gitSymbol)}main</span>`, venv: `<span style="color:${c.muted}">(.venv)</span>`, duration: `<span style="color:${c.muted}">took 3.2s</span>`,
    status: `<span style="color:${c.error}">✗ 1</span>`, time: `<span style="color:${c.muted}">12:34</span>`, shell: `<span style="color:${c.muted}">pwsh</span>` }[s] || '');
  const line = (p.segments || []).map(seg).filter(Boolean).join(' ');
  const sym = `<span style="color:${c.symbol}">${esc(p.symbol)}</span>`;
  return `<div class="tpv" style="background:${wallCss(st.draft) || '#22252c'}"><div class="tpw" style="background:${hexA(tc.background, P.cfg.terminal.opacity / 100)};color:${tc.foreground};font-family:${esc(P.cfg.terminal.font)};font-size:14px;line-height:1.45;padding:16px;border-radius:${P.cfg.terminal.radius}px">${p.newline ? `${line}\n${sym} npm test` : `${line} ${sym} npm test`}</div></div>
    ${P.translateAvailable ? '' : '<p class="note">Command translation runs in the Prism shell on Windows.</p>'}`;
}
function previewFoot() {
  const meta = st.themes.find(t => t.id === st.sel);
  return `<div class="pfoot">
    <label><span>Theme name</span><input type="text" data-d="name" value="${esc(st.draft.name)}"></label>
    <div class="pstatus">${statusHtml()}</div>
    <div class="pbtns"><button class="btn ghost" data-save ${st.dirty || !meta ? '' : 'disabled'}>Save</button>
      <button class="btn" data-apply ${st.busy ? 'disabled' : ''}>${st.busy ? '<span class="spin"></span>Applying…' : 'Apply to Windows'}</button></div>
    ${st.log ? `<details class="log" ${st.logOpen ? 'open' : ''}><summary>Details</summary><pre>${esc(st.log)}</pre></details>` : ''}
  </div>`;
}
function statusHtml() {
  const meta = st.themes.find(t => t.id === st.sel);
  if (st.dirty) return `<span class="d warn"></span>Unsaved changes${meta?.builtIn ? ' (saved as your own theme)' : ''}`;
  if (st.state?.current?.id === st.sel) return '<span class="d ok"></span>Active on this PC';
  return '<span class="d"></span>Not applied';
}
// themes without dock/bar settings preview with the current ones
const withDesk = t => ({ ...t, dock: t.dock || { enabled: P.cfg.dock.enabled }, bar: t.bar || { enabled: P.cfg.bar.enabled } });
function renderPreview() {
  const s = SEC(st.section);
  if (!s.pv) { $('#sPreview').innerHTML = ''; return; }
  $('#sPreview').innerHTML = s.pv === 'term' ? termPreview() : s.pv === 'prompt' ? promptPreview() : `<div class="dwrap">${desk(withDesk(st.draft), false)}</div>${previewFoot()}`;
}
function updatePreview() {
  const s = SEC(st.section);
  if (s.pv === 'term') { $('#sPreview').innerHTML = termPreview(); return; }
  if (s.pv === 'prompt') { $('#sPreview').innerHTML = promptPreview(); return; }
  if (s.pv !== 'desk') return;
  const dw = $('#sPreview .dwrap'); if (dw) dw.innerHTML = desk(withDesk(st.draft), false);
  const ps = $('#sPreview .pstatus'); if (ps) ps.innerHTML = statusHtml();
  const sv = $('#sPreview [data-save]'); if (sv) sv.disabled = !st.dirty && !!st.themes.find(t => t.id === st.sel);
  if (st.section === 'themes') { const m = $('.tcard.on .desk'); if (m) m.outerHTML = desk(st.draft, true); }
}

// ---------- dock and menu bar ----------
function secDock() {
  const d = P.cfg.dock;
  const pinned = Array.isArray(d.pinned) ? d.pinned : null;
  const list = pinned ? pinned.map((p, i) => `<li><b>${esc(p.name || p.path)}</b><small>${esc(p.prism ? 'Prism' : p.path)}</small>
      <span class="acts"><button class="ic sm" data-pinup="${i}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button class="ic sm" data-pindown="${i}" ${i < pinned.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button><button class="ic sm" data-pinrm="${i}" aria-label="Remove">✕</button></span></li>`).join('')
    : '<li class="empty">Default apps: File Explorer, your browser, Prism and Settings.</li>';
  return group('Dock', toggle('data-c', 'dock.enabled', 'Show the dock', 'Also hides the Windows taskbar. It comes back when you turn the dock off or quit Prism.')
      + range('data-c', 'dock.iconSize', 'Icon size', 32, 80, ' px') + range('data-c', 'dock.magnification', 'Magnification', 1, 2.2, '×', .05)
      + toggle('data-c', 'dock.autohide', 'Hide automatically', 'Move the mouse to the bottom edge to show it.')
      + toggle('data-c', 'dock.labels', 'Show app names on hover') + toggle('data-c', 'dock.showRunning', 'Show running apps that are not pinned')
      + toggle('data-c', 'dock.hideTaskbar', 'Hide the Windows taskbar while the dock is on')
      + toggle('data-c', 'dock.reserveSpace', 'Keep maximized windows above the dock'))
    + group('Pinned apps' + lock('dock.pinned'), `<ul class="plist">${list}</ul><div class="btns"><button class="btn ghost" data-pinadd>+ Add app…</button><button class="btn ghost" data-pinrunning>+ Add a running app</button>${pinned ? '<button class="btn ghost" data-pinreset>Reset to defaults</button>' : ''}</div>
      <div id="runningList"></div><p class="note">Tip: right-click any app in the dock and choose “Keep in Dock”.</p>`);
}
function secBar() {
  const b = P.cfg.bar;
  return group('Menu bar', toggle('data-c', 'bar.enabled', 'Show the menu bar') + range('data-c', 'bar.height', 'Height', 24, 44, ' px')
      + toggle('data-c', 'bar.reserveSpace', 'Keep maximized windows below the bar')
      + text('data-c', 'bar.clockFormat', 'Clock format', 'Tokens: ddd dddd d dd MMM MMMM yyyy HH H hh h mm ss tt', 'ddd d MMM  HH:mm'))
    + group('Left', chips('bar.left', MODULES, b.left || [])) + group('Center', chips('bar.center', MODULES, b.center || [])) + group('Right', chips('bar.right', MODULES, b.right || []))
    + '<p class="note">Click modules in the order you want them. Workspaces appear while window tiling (GlazeWM) runs.</p>';
}

// ---------- terminal, shell, aliases, keys, files, about ----------
function secTerminal() {
  const t = P.cfg.terminal, pal = P.palette();
  const custom = Object.values(t.colors || {}).some(v => HEX.test(v || ''));
  const schemes = Object.entries(P.SCHEMES).map(([id, s]) => `<button class="pre${t.scheme === id && !custom ? ' on' : ''}" data-scheme="${id}" style="background:${s.background};color:${s.foreground}">
      <span class="sw">${[s.red, s.green, s.yellow, s.blue, s.magenta].map(c => `<i style="background:${c}"></i>`).join('')}</span>${esc(s.name)}</button>`).join('');
  return group('Color scheme' + lock('terminal.scheme'), `<div class="presets">${schemes}</div>${custom ? '<p class="note">Your own colors are on top of the scheme. Picking a scheme resets them.</p>' : ''}`)
    + group('Background', range('data-c', 'terminal.opacity', 'Opacity', 0, 100, '%') + toggle('data-c', 'terminal.blur', 'Blur the desktop behind the window', 'Applies to new windows.')
      + `<div class="row">${label('Background image' + lock('terminal.backgroundImage'), t.backgroundImage ? esc(t.backgroundImage.split(/[\\/]/).pop()) : 'Optional, shown behind the text')}<span class="btns"><button class="btn ghost" data-bgimg>Choose…</button>${t.backgroundImage ? '<button class="btn ghost" data-bgclear>Remove</button>' : ''}</span></div>`
      + (t.backgroundImage ? range('data-c', 'terminal.backgroundImageOpacity', 'Image visibility', 0, 1, '', .02) : ''))
    + group('Colors', `<div class="crows">${['background', 'foreground', 'accent'].map(k => colorRow('data-c', 'terminal.colors.' + k, k[0].toUpperCase() + k.slice(1), '', pal[k])).join('')}</div>
      <details class="more"><summary>All 16 terminal colors</summary><div class="crows tight">${ANSI_NAMES.map(k => colorRow('data-c', 'terminal.colors.' + k, k.replace(/([A-Z])/g, ' $1').toLowerCase(), '', pal[k])).join('')}</div></details>`)
    + group('Text', text('data-c', 'terminal.font', 'Font', 'CSS font list, e.g. "JetBrains Mono", Consolas, monospace')
      + range('data-c', 'terminal.fontSize', 'Size', 8, 32, ' px') + range('data-c', 'terminal.lineHeight', 'Line height', 1, 1.8, '', .05) + range('data-c', 'terminal.letterSpacing', 'Letter spacing', -2, 4, ' px', .5))
    + group('Window', range('data-c', 'terminal.padding', 'Padding', 0, 48, ' px') + range('data-c', 'terminal.radius', 'Corner radius', 0, 24, ' px')
      + seg('data-c', 'terminal.cursor', [['bar', 'Bar'], ['block', 'Block'], ['underline', 'Underline']], 'Cursor') + toggle('data-c', 'terminal.cursorBlink', 'Blinking cursor')
      + toggle('data-c', 'terminal.copyOnSelect', 'Copy text as soon as you select it') + toggle('data-c', 'terminal.rightClickPaste', 'Right-click pastes'));
}
function secShell() {
  const s = P.cfg.shell, p = P.cfg.prompt;
  return group('Shell', `<div class="field"><span>New tabs open${lock('shell.default')}</span><select data-c="shell.default" ${over('shell.default') ? 'disabled' : ''}>${P.profiles.map(x => `<option value="${esc(x.id)}" ${x.id === s.default ? 'selected' : ''}>${esc(x.name)}${x.prism ? ' (recommended)' : ''}</option>`).join('')}</select></div>`
      + '<p class="note">The <b>Prism</b> shell is PowerShell with Linux commands, bash and cmd syntax, history suggestions and this prompt.</p>')
    + group('Translation', toggle('data-c', 'shell.translate', 'Translate bash and cmd syntax', 'For example <code class="k">a &amp;&amp; b</code> <code class="k">$PATH</code> <code class="k">%APPDATA%</code> <code class="k">dir /s</code> <code class="k">del /q</code> <code class="k">set X=1</code> <code class="k">sudo !!</code>. Start a line with a space to run it exactly as typed.')
      + toggle('data-c', 'shell.translateNotify', 'Show what was translated')
      + toggle('data-c', 'shell.linux', 'Linux commands in PowerShell', '<code class="k">ls -la</code> <code class="k">rm -rf</code> <code class="k">grep -rn</code> <code class="k">touch</code> <code class="k">which</code> <code class="k">head</code> <code class="k">tail</code> <code class="k">df -h</code> <code class="k">free -h</code> <code class="k">sudo</code>…')
      + toggle('data-c', 'shell.predictions', 'Suggestions from history while you type', 'PowerShell 7. Press → to accept.'))
    + group('Prompt', seg('data-c', 'prompt.style', [['auto', 'Auto'], ['prism', 'Prism'], ['keep', 'Keep mine']], 'Style') + '<p class="note">Auto keeps oh-my-posh or Starship if you use them. Changes show in new tabs and after the next command.</p>'
      + `<div class="field"><span>Segments, in order${lock('prompt.segments')}</span>${chips('prompt.segments', SEGMENTS, p.segments || [])}</div>`
      + text('data-c', 'prompt.symbol', 'Symbol', '', '❯') + toggle('data-c', 'prompt.newline', 'Type on a new line') + toggle('data-c', 'prompt.blankLine', 'Blank line between commands')
      + toggle('data-c', 'prompt.unixPaths', 'Unix-style paths (~/projects/app)') + range('data-c', 'prompt.pathDepth', 'Folders to show (0 = all)', 0, 8, '')
      + `<div class="crows">${['path', 'git', 'symbol', 'error', 'muted'].map(k => colorRow('data-c', 'prompt.colors.' + k, k[0].toUpperCase() + k.slice(1))).join('')}</div>`);
}
function secAliases() {
  const list = P.cfg.aliases.length ? P.cfg.aliases.map((c, i) => `<li><b>${esc(c.name)}</b><button data-ae="${i}">Edit</button><button data-ad="${i}">Delete</button><small>${esc(c.desc || (c.type === 'text' ? 'echo: ' : '') + c.body.split('\n')[0])}</small></li>`).join('')
    : '<li class="empty">No aliases yet.</li>';
  const c = st.editing != null ? P.cfg.aliases.find(x => x.name === st.editing) : null;
  return group('Your aliases' + lock('aliases'), `<ul class="cmds">${list}</ul><p class="note">From the terminal: <code class="k">prism alias ll 'ls -la'</code> or bash style <code class="k">alias ll='ls -la'</code>.</p>`)
    + group(c ? `Edit ${esc(c.name)}` : 'New alias', `<form id="aliasForm" style="display:grid;gap:14px">
      <div class="field"><span>Name</span><input type="text" id="aName" value="${esc(c?.name || '')}" placeholder="e.g. proj" spellcheck="false" autocapitalize="off" required></div>
      <div class="field"><span>Type</span><div class="seg"><button type="button" data-atype="run" class="${(c?.type || 'run') === 'run' ? 'on' : ''}">Runs commands</button><button type="button" data-atype="text" class="${c?.type === 'text' ? 'on' : ''}">Prints text</button></div></div>
      <div class="field">${label('Command', 'Variables: {1} {2}… arguments, {args} all of them, {date} {time} {user}. Separate commands with ; or &&. Bash style works too.')}<textarea id="aBody" spellcheck="false" required placeholder="cd ~/projects/{1} && code .">${esc(c?.body || '')}</textarea></div>
      <div class="field"><span>Description (optional)</span><input type="text" id="aDesc" value="${esc(c?.desc || '')}"></div>
      <p class="err" id="aErr"></p>
      <div class="btns"><button class="btn" type="submit">Save alias</button>${c ? '<button class="btn ghost" type="button" data-acancel>Cancel</button>' : ''}</div></form>`);
}
function secKeys() {
  return group('Shortcuts', `<table class="keys">${Object.entries(KEYS).map(([k, l]) => `<tr><td>${l}${lock('keys.' + k)}</td><td><input class="keyin" data-key="${k}" value="${esc(P.cfg.keys[k] || '')}" placeholder="press keys…" readonly ${over('keys.' + k) ? 'disabled' : ''}></td></tr>`).join('')}</table>
    <p class="note">Click a field, then press the shortcut. Backspace clears it. “Show/hide Prism” works from any app, like Ctrl+Alt+T on Ubuntu.</p>`)
    + group('Also', `<table class="keys"><tr><td>Switch to tab 1–9</td><td><code class="k">Alt+1…9</code></td></tr><tr><td>Copy a selection</td><td><code class="k">Ctrl+C</code></td></tr><tr><td>Paste</td><td><code class="k">Ctrl+V</code> or right-click</td></tr>
      <tr><td>Accept a suggestion (PowerShell 7)</td><td><code class="k">→</code></td></tr><tr><td>Search history</td><td>type the start, then <code class="k">↑</code></td></tr><tr><td>Tiling (GlazeWM)</td><td><code class="k">Alt+arrows</code> <code class="k">Alt+1…9</code> <code class="k">Alt+Shift+E</code></td></tr></table>`);
}
function secFiles() {
  const f = P.C.files || {}, ov = P.C.overridden || [];
  return group('Files', `<table class="keys">
      <tr><td><b>config.jsonc</b><small class="path">${esc(f.config)}</small></td><td><button class="btn ghost" data-open="config">Open</button></td></tr>
      <tr><td><b>style.css</b><small class="path">${esc(f.style)}</small></td><td><button class="btn ghost" data-open="style">Open</button></td></tr>
      <tr><td><b>Config folder</b><small class="path">${esc(f.dir)}</small></td><td><button class="btn ghost" data-open="dir">Open</button></td></tr></table>
      <p class="note">config.jsonc is JSON with comments; anything set there wins over this screen. style.css is loaded into the terminal, the dock and the menu bar (the selectors are listed at the top of the file).</p>`)
    + (P.C.error ? group('Problem', `<p class="note warn">${esc(P.C.error)}</p>`) : '')
    + group('Set in config.jsonc', ov.length ? `<div class="chips">${ov.map(o => `<span class="chip on">${esc(o)}</span>`).join('')}</div>` : '<p class="note">Nothing yet: everything comes from this Settings screen.</p>')
    + group('Shell files', '<p class="note">Prism writes startup files for PowerShell, bash and cmd from your settings. Your own $PROFILE and .bashrc still load first.</p><div class="btns"><button class="btn ghost" data-open="data">Open Prism data folder</button></div>');
}
function secAbout() {
  return group('Prism', `<p class="note">A terminal that replaces the Windows terminal and restyles the whole desktop.</p>
      <div class="btns"><button class="btn ghost" data-link="https://github.com/onufry444/prism">GitHub</button><button class="btn ghost" data-link="https://github.com/onufry444/prism/issues">Report a problem</button></div>`)
    + group('From any terminal', `<table class="keys">
      <tr><td><code class="k">prism</code></td><td>open Prism</td></tr><tr><td><code class="k">prism settings</code></td><td>open these settings</td></tr>
      <tr><td><code class="k">prism apply tiles</code></td><td>apply a desktop theme</td></tr><tr><td><code class="k">prism restore</code></td><td>original Windows look</td></tr>
      <tr><td><code class="k">prism update</code></td><td>update Prism</td></tr><tr><td><code class="k">prism uninstall</code></td><td>remove Prism (restores Windows first)</td></tr></table>`);
}

// ---------- actions ----------
const slug = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'my-theme';
function uniqueId(base) {
  let id = base.length < 2 ? 'theme-' + base : base, n = 2;
  while (st.themes.some(t => t.id === id && (t.builtIn || t.id !== st.sel))) id = `${base}-${n++}`;
  return id;
}
async function saveDraft() {
  const d = clone(st.draft), meta = st.themes.find(t => t.id === st.sel);
  d.name = (d.name || '').trim() || 'My theme';
  if (!meta || meta.builtIn) {
    if (meta && d.name === meta.theme.name) d.name += ' (mine)';
    d.id = uniqueId(slug(d.name));
    d.author = 'You';
  }
  // a theme is the whole look: include the current dock and menu bar
  const { pinned, ...dock } = P.cfg.dock;
  d.dock = dock; d.bar = { ...P.cfg.bar };
  const r = await api.themes.save(d);
  if (!r.ok) { P.toast(r.error); return null; }
  st.themes = await api.themes.list();
  st.sel = r.theme.id; st.draft = clone(r.theme); st.dirty = false;
  if (st.section === 'themes') renderSection();
  renderPreview();
  P.toast(`Saved “${r.theme.name}”`);
  return r;
}
async function applyDraft() {
  if (st.busy) return;
  let meta = st.themes.find(t => t.id === st.sel);
  if (st.dirty || !meta) { const r = await saveDraft(); if (!r) return; meta = st.themes.find(t => t.id === r.theme.id) || { id: r.theme.id, path: r.path, theme: r.theme }; }
  st.busy = true; st.log = ''; st.logOpen = false;
  renderPreview();
  const r = await api.prismRun('apply', meta.path);
  st.busy = false;
  st.state = await api.prismState();
  if (r.code === 0) P.toast(`Applied “${meta.theme.name}”`);
  else { st.logOpen = true; if (r.error) st.log += r.error; P.toast(r.error || 'Something went wrong. See Details.'); }
  if (st.section === 'themes') renderSection();
  renderPreview();
}
async function restoreWindows() {
  if (!confirm('Restore the original Windows look (colors, wallpaper, tiling, dock and menu bar) from the backup Prism made before your first theme?')) return;
  st.busy = true; st.log = ''; renderSection(); renderPreview();
  const r = await api.prismRun('restore');
  st.busy = false;
  st.state = await api.prismState();
  P.toast(r.code === 0 ? 'Original Windows look restored' : (r.error || 'Restore failed. See Details.'));
  if (r.code !== 0) st.logOpen = true;
  renderSection(); renderPreview();
}
api.onPrismLog(d => {
  st.log += d;
  const pre = $('#sPreview .log pre');
  if (pre) { pre.textContent = st.log; pre.scrollTop = pre.scrollHeight; } else if (SEC(st.section).pv === 'desk') renderPreview();
});
function harmony() {
  const [r, g, b] = P.rgb(st.draft.colors.accent), dark = st.draft.colors.mode !== 'light';
  const mix = (t, a) => '#' + [r, g, b].map((v, i) => Math.round(v * a + t[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
  const base = dark ? [14, 15, 20] : [246, 244, 240], ink = dark ? [236, 234, 228] : [28, 28, 32];
  Object.assign(st.draft.colors, { background: mix(base, .08), surface: mix(base, .16), text: mix(ink, .06), muted: mix(dark ? [130, 132, 142] : [110, 108, 104], .15), accent2: '#' + [b, r, g].map(v => v.toString(16).padStart(2, '0')).join('') });
  st.dirty = true; renderSection(); updatePreview();
}
function shuffleWall() {
  const pool = ['surface', 'accent', 'accent2', 'muted'].map(k => st.draft.colors[k]).filter(Boolean).sort(() => Math.random() - .5);
  set(st.draft, 'wallpaper.colors', [st.draft.colors.background, ...pool.slice(0, 1 + Math.floor(Math.random() * 2))]);
  set(st.draft, 'wallpaper.angle', Math.round(Math.random() * 360));
  st.dirty = true; renderSection(); updatePreview();
}
// the dock's built-in defaults are written out the first time you edit the list
const currentPins = async () => Array.isArray(P.cfg.dock.pinned) ? [...P.cfg.dock.pinned] : await api.dockDefaults();
async function savePins(list) { await P.set({ dock: { pinned: list } }); renderSection(); }

// ---------- events ----------
const root = $('#settings');
root.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.s) return go(d.s);
  if (b.id === 'sClose') return P.closeSettings();
  if (d.theme) {
    if (d.theme === st.sel) return;
    if (st.dirty && !confirm('Discard your unsaved changes to this theme?')) return;
    select(d.theme); renderSection(); renderPreview(); return;
  }
  if ('new' in d) { const base = clone(st.draft); base.name = 'My theme'; base.description = ''; st.draft = base; st.sel = null; st.dirty = true; return go('colors'); }
  if ('restore' in d) return restoreWindows();
  if ('deltheme' in d) {
    const meta = st.themes.find(t => t.id === st.sel);
    if (!meta || !confirm(`Delete “${meta.theme.name}”?`)) return;
    const r = await api.themes.remove(meta.id);
    if (!r.ok) return P.toast(r.error);
    await loadThemes(); select(st.themes[0]?.id); renderSection(); renderPreview(); return;
  }
  if ('save' in d) return saveDraft();
  if ('apply' in d) return applyDraft();
  if (d.seg) { setDraft(d.seg, d.v === 'true' ? true : d.v === 'false' ? false : d.v); renderSection(); return; }
  if (d.cseg) { setLive(d.cseg, d.v, true); renderSection(); return; }
  if (d.chips) {
    const list = [...(get(P.cfg, d.chips) || [])], i = list.indexOf(d.v);
    if (i >= 0) list.splice(i, 1); else list.push(d.v);
    setLive(d.chips, list, true); renderSection(); return;
  }
  if (d.scheme) { P.cfg.terminal.colors = {}; P.cfg.terminal.scheme = d.scheme; await P.set({ terminal: { scheme: d.scheme } }); renderSection(); updatePreview(); return; }
  if ('harmony' in d) return harmony();
  if ('addstop' in d) { st.draft.wallpaper.colors.push(st.draft.colors.accent2 || st.draft.colors.accent); st.dirty = true; renderSection(); updatePreview(); return; }
  if (d.rmstop) { st.draft.wallpaper.colors.splice(+d.rmstop, 1); st.dirty = true; renderSection(); updatePreview(); return; }
  if ('shuffle' in d) return shuffleWall();
  if ('wppick' in d) { const p = await api.pickImage(); if (p) { setDraft('wallpaper.path', p); renderSection(); } return; }
  if ('bgimg' in d) { const p = await api.pickImage(); if (p) { setLive('terminal.backgroundImage', p, true); renderSection(); } return; }
  if ('bgclear' in d) { setLive('terminal.backgroundImage', '', true); renderSection(); return; }
  if ('pinadd' in d) { const p = await api.pickApp(); if (p) savePins([...(await currentPins()), { name: p.split(/[\\/]/).pop().replace(/\.(exe|lnk|cmd|bat)$/i, ''), path: p }]); return; }
  if ('pinrunning' in d) {
    st.running = await api.runningApps();
    $('#runningList').innerHTML = st.running.length ? `<div class="chips">${st.running.map((a, i) => `<button class="chip" data-addrun="${i}">${esc(a.name)}</button>`).join('')}</div>` : '<p class="note">No running apps found.</p>';
    return;
  }
  if (d.addrun) { savePins([...(await currentPins()), st.running[+d.addrun]]); return; }
  if (d.pinrm) { const l = await currentPins(); l.splice(+d.pinrm, 1); savePins(l); return; }
  if (d.pinup || d.pindown) { const l = await currentPins(), i = +(d.pinup || d.pindown), j = d.pinup ? i - 1 : i + 1; [l[i], l[j]] = [l[j], l[i]]; savePins(l); return; }
  if ('pinreset' in d) { savePins(null); return; }
  if (d.open) return api.openFile(d.open);
  if (d.link) return api.openExternal(d.link);
  if (d.ae) { st.editing = P.cfg.aliases[+d.ae]?.name; renderSection(); $('#aName')?.focus(); return; }
  if (d.ad) { const c = P.cfg.aliases[+d.ad]; await P.set({ aliases: P.cfg.aliases.filter((x, i) => i !== +d.ad) }); if (st.editing === c.name) st.editing = null; renderSection(); P.toast(`Deleted ${c.name}`); return; }
  if ('acancel' in d) { st.editing = null; renderSection(); return; }
  if (d.atype) b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
});
root.addEventListener('input', e => {
  const el = e.target, d = el.dataset;
  if (el.classList.contains('keyin')) return;
  const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
  if (el.classList.contains('hex') && !HEX.test(v)) return;
  const pair = (k, p) => root.querySelectorAll(`[${k}="${p}"]`).forEach(x => { if (x !== el && x.type !== 'checkbox') x.value = v; });
  if (d.d) {
    if (d.d === 'name') { st.draft.name = v; st.dirty = true; updatePreview(); return; }
    setDraft(d.d, v); pair('data-d', d.d);
    if (d.re) renderSection();
  } else if (d.stop !== undefined) { st.draft.wallpaper.colors[+d.stop] = v; st.dirty = true; pair('data-stop', d.stop); updatePreview(); }
  else if (d.c && el.tagName !== 'SELECT') {
    const instant = el.type === 'checkbox';
    setLive(d.c, v, instant); pair('data-c', d.c);
    if (instant && d.re) renderSection();
  }
  const out = root.querySelector(`output[data-out="${d.d || d.c}"]`);
  if (out && el.type === 'range') out.textContent = fmt(v, +el.step || 1) + out.dataset.unit;
});
root.addEventListener('change', e => { const el = e.target; if (el.tagName === 'SELECT' && el.dataset.c) setLive(el.dataset.c, el.value, true); });
root.addEventListener('keydown', e => {
  const el = e.target;
  if (!el.classList || !el.classList.contains('keyin')) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') { el.blur(); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { el.value = ''; setLive('keys.' + el.dataset.key, '', true); return; }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const combo = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Cmd', k].filter(Boolean).join('+');
  el.value = combo; setLive('keys.' + el.dataset.key, combo, true);
}, true);
root.addEventListener('submit', async e => {
  if (e.target.id !== 'aliasForm') return;
  e.preventDefault();
  const name = $('#aName').value.trim(), type = root.querySelector('[data-atype].on')?.dataset.atype || 'run', body = $('#aBody').value;
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,40}$/.test(name)) { $('#aErr').textContent = 'Name: letters, digits, _ . or -, no spaces.'; return; }
  if (['settings', 'prism', 'cd', 'exit'].includes(name.toLowerCase())) { $('#aErr').textContent = `“${name}” is reserved.`; return; }
  if (!body.trim()) { $('#aErr').textContent = 'The command is empty.'; return; }
  const list = P.cfg.aliases.filter(a => a.name !== name && a.name !== st.editing).concat([{ name, type, body, desc: $('#aDesc').value.trim() }]).sort((a, b) => a.name.localeCompare(b.name));
  await P.set({ aliases: list });
  st.editing = null; renderSection();
  P.toast(`Alias ${name} saved. Use it in any tab.`);
});
document.addEventListener('keydown', e => {
  if (root.hidden) return;
  if (e.key === 'Escape' && !e.target.closest('textarea') && !(e.target.classList && e.target.classList.contains('keyin'))) { e.preventDefault(); P.closeSettings(); }
});
// re-render when the config changes elsewhere (config.jsonc, a shell command), unless you are typing here
P.on('config', () => {
  if (root.hidden) return;
  const typing = root.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (!typing && !['themes', 'colors', 'wallpaper', 'windows'].includes(st.section)) renderSection();
  updatePreview();
});
}
