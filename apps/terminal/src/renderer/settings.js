'use strict';
// Ustawienia Prism otwierane komendą `settings` w terminalu: motyw całego Windows z podglądem,
// wygląd terminala, własne komendy. Wszystko obsługiwane myszką.
{
const P = window.Prism, { api, $, esc, hexA } = P;
const HEX = /^#[0-9a-f]{6}$/i;
const clone = o => JSON.parse(JSON.stringify(o));

const ICON = {
  theme: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.3"/><circle cx="12" cy="7.5" r="1.3"/><circle cx="15.5" cy="10" r="1.3"/><path d="M12 21a2.5 2.5 0 0 1 0-5h2a3 3 0 0 0 3-3"/>',
  colors: '<path d="M12 3c3.2 4 6 7.2 6 11a6 6 0 0 1-12 0c0-3.8 2.8-7 6-11z"/>',
  wallpaper: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>',
  windows: '<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>',
  taskbar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16h18M9 18h.01M12 18h.01M15 18h.01"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12.5 15H17"/>',
  commands: '<path d="M9 5H7a2 2 0 0 0-2 2v3l-2 2 2 2v3a2 2 0 0 0 2 2h2M15 5h2a2 2 0 0 1 2 2v3l2 2-2 2v3a2 2 0 0 1-2 2h-2"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/>'
};
const SECTIONS = [
  { id: 'theme', name: 'Motyw', sub: 'Gotowe wyglądy całego Windowsa. Kliknij kartę, żeby zobaczyć podgląd, potem „Zastosuj w Windows”.', pv: 'desk' },
  { id: 'colors', name: 'Kolory', sub: 'Tryb, paleta i efekty. Te kolory trafiają do Windowsa, ramek okien, tapety i terminala.', pv: 'desk' },
  { id: 'wallpaper', name: 'Tapeta', sub: 'Gradient z dowolnych kolorów albo Twój obraz.', pv: 'desk' },
  { id: 'windows', name: 'Okna', sub: 'Kafelkowanie, odstępy, ramki i rogi okien.', pv: 'desk' },
  { id: 'taskbar', name: 'Pasek zadań', sub: 'Położenie ikon i styl paska.', pv: 'desk' },
  'sep',
  { id: 'terminal', name: 'Terminal', sub: 'Wygląd tego okna. Zmiany widać od razu.', pv: 'term' },
  { id: 'commands', name: 'Komendy', sub: 'Własne komendy działają w terminalu jak zwykłe polecenia: z argumentami i potokami.', pv: null },
  { id: 'about', name: 'O Prism', sub: 'Skróty, samouczek, aktualizacje.', pv: null }
];
const SEC = id => SECTIONS.find(s => s.id === id);
const ALIAS = { look: 'terminal', cmd: 'commands', komendy: 'commands', motyw: 'theme', motywy: 'theme', kolory: 'colors', tapeta: 'wallpaper', okna: 'windows', pasek: 'taskbar', info: 'about' };
const COLOR_NAMES = { background: 'Tło', surface: 'Powierzchnie', text: 'Tekst', muted: 'Tekst przygaszony', accent: 'Akcent', accent2: 'Drugi akcent' };
const COLOR_HINTS = { background: 'tło terminala, tapety, okien', surface: 'paski, karty, nieaktywne ramki', text: 'główny tekst', muted: 'podpisy i mniej ważne rzeczy', accent: 'akcent Windows, aktywna ramka, kursor', accent2: 'dodatki i tapeta' };
const DEF = { 'effects.transparency': true, 'effects.opacity': 80, 'effects.blur': true, 'effects.radius': 12, 'fonts.mono': 'Cascadia Code', 'fonts.size': 14,
  'wallpaper.type': 'gradient', 'wallpaper.angle': 120, 'windows.tiling': false, 'windows.gaps.inner': 10, 'windows.gaps.outer': 12, 'windows.border.enabled': true,
  'windows.border.focused': 'accent', 'windows.border.inactive': 'surface', 'windows.corners': 'rounded', 'windows.hideTitleBar': false, 'windows.inactiveOpacity': 100,
  'taskbar.alignment': 'center', 'taskbar.windhawk.taskbarStyler': '' };

const st = { section: 'theme', themes: [], sel: null, draft: null, dirty: false, state: null, busy: false, log: '', logOpen: false };

// ---------- ścieżki w obiektach ----------
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function set(o, p, v) { const ks = p.split('.'); let c = o; for (const k of ks.slice(0, -1)) { if (c[k] == null || typeof c[k] !== 'object') c[k] = {}; c = c[k]; } c[ks[ks.length - 1]] = v; }
const dget = p => { const v = get(st.draft, p); return v === undefined ? DEF[p] : v; };
const color = (t, v, fb) => HEX.test(v || '') ? v : (HEX.test(t?.colors?.[v] || '') ? t.colors[v] : fb);
function setDraft(p, v) {
  if (p === 'taskbar.windhawk.taskbarStyler' && !v) { if (st.draft.taskbar?.windhawk) delete st.draft.taskbar.windhawk.taskbarStyler; }
  else set(st.draft, p, v);
  st.dirty = true;
  updatePreview();
}

// ---------- otwieranie ----------
P.openSettings = async sec => {
  const el = $('#settings');
  const wasHidden = el.hidden;
  el.hidden = false;
  P.renderTour();
  if (wasHidden || !st.themes.length) await loadThemes();
  go(ALIAS[sec] || (SEC(sec) ? sec : wasHidden ? 'theme' : st.section));
};
P.closeSettings = () => {
  if ($('#settings').hidden) return;
  $('#settings').hidden = true;
  P.renderTour();
  P.active?.term.focus();
};
P.toggleSettings = () => ($('#settings').hidden ? P.openSettings() : P.closeSettings());
P.goSection = sec => go(sec);

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
  st.draft = t ? clone(t.theme) : { id: 'moj-motyw', name: 'Mój motyw', colors: { mode: 'dark', background: '#101216', surface: '#1a1d24', text: '#e7e5df', muted: '#8a8a90', accent: '#7aa7ff', accent2: '#ff9f7a' } };
  st.dirty = false;
}

// ---------- render ----------
function go(sec) {
  st.section = SEC(sec) ? sec : 'theme';
  const s = SEC(st.section);
  $('#sNav').innerHTML = SECTIONS.map(x => x === 'sep' ? '<div class="sep"></div>'
    : `<button class="nb${x.id === st.section ? ' on' : ''}" data-s="${x.id}"><svg viewBox="0 0 24 24">${ICON[x.id]}</svg>${x.name}</button>`).join('')
    + '<div class="hint"><kbd>Esc</kbd> wraca do terminala</div>';
  $('#sTitle').textContent = s.name;
  $('#sSub').textContent = s.sub;
  $('#settings').classList.toggle('nopv', !s.pv);
  renderTourBar();
  renderSection();
  renderPreview();
  $('#sMain').scrollTop = 0;
}
function renderTourBar() {
  const next = P.tourActive() && P.tourNext();
  $('#sTour').innerHTML = next && next.id === 'apply' && SEC(st.section).pv === 'desk'
    ? '<div class="tourbar"><b>Samouczek</b> Wybierz motyw i kliknij „Zastosuj w Windows” w panelu podglądu.</div>' : '';
}
function renderSection() {
  const R = { theme: secTheme, colors: secColors, wallpaper: secWallpaper, windows: secWindows, taskbar: secTaskbar, terminal: secTerminal, commands: secCommands, about: secAbout };
  $('#sContent').innerHTML = R[st.section]();
}

// ---------- kontrolki ----------
const group = (title, body, cls = '') => `<div class="group ${cls}">${title ? `<h3>${title}</h3>` : ''}${body}</div>`;
const label = (t, hint) => `<span>${t}${hint ? `<small>${hint}</small>` : ''}</span>`;
const toggle = (p, t, hint, attr = 'data-d', val) => {
  const v = val !== undefined ? val : dget(p);
  return `<label class="row">${label(t, hint)}<span class="sw-t"><input type="checkbox" ${attr}="${p}" data-re="1" ${v ? 'checked' : ''}><i></i></span></label>`;
};
const range = (p, t, min, max, unit, step = 1, attr = 'data-d', val, hint) => {
  const v = val !== undefined ? val : dget(p);
  return `<div class="field">${label(t, hint)}<div class="range"><input type="range" ${attr}="${p}" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${esc(t)}"><output data-out="${p}" data-unit="${unit}">${fmt(v, step)}${unit}</output></div></div>`;
};
const fmt = (v, step) => step < 1 ? (+v).toFixed(2) : v;
const seg = (p, opts, attr = 'data-seg', val) => {
  const v = val !== undefined ? val : dget(p);
  return `<div class="seg" role="radiogroup">${opts.map(([k, t]) => `<button ${attr}="${p}" data-v="${esc(k)}" class="${String(v) === String(k) ? 'on' : ''}" role="radio" aria-checked="${String(v) === String(k)}">${t}</button>`).join('')}</div>`;
};
const colorRow = (p, t, hint, attr = 'data-d', val) => {
  const v = (val !== undefined ? val : dget(p)) || '#000000';
  return `<label class="crow"><input type="color" ${attr}="${p}" value="${v}" aria-label="${esc(t)}"><span><b>${t}</b><small>${hint || ''}</small></span><input class="hex" ${attr}="${p}" value="${v}" maxlength="7" spellcheck="false" aria-label="${esc(t)} (hex)"></label>`;
};
const refSel = (p, t) => {
  const v = dget(p);
  return `<div class="field"><span>${t}</span><div class="refsel">${Object.keys(COLOR_NAMES).filter(n => st.draft.colors[n]).map(n =>
    `<button class="swb${v === n ? ' on' : ''}" data-seg="${p}" data-v="${n}" title="${COLOR_NAMES[n]}" aria-label="${COLOR_NAMES[n]}" style="background:${st.draft.colors[n]}"></button>`).join('')}
    <input type="color" data-d="${p}" value="${color(st.draft, v, '#888888')}" title="Własny kolor" aria-label="Własny kolor"></div></div>`;
};

// ---------- sekcje motywu ----------
function secTheme() {
  const cur = st.state?.current?.id;
  const cards = st.themes.map(t => `<button class="tcard${t.id === st.sel ? ' on' : ''}" data-theme="${esc(t.id)}">
      ${desk(t.id === st.sel && st.dirty ? st.draft : t.theme, true)}
      <div class="tm"><b>${esc(t.theme.name)}</b>${t.id === cur ? '<span class="badge ok">Aktywny</span>' : ''}${t.builtIn ? '' : '<span class="badge">Twój</span>'}</div>
      <p>${esc(t.theme.description || '')}</p></button>`).join('');
  const selMeta = st.themes.find(t => t.id === st.sel);
  return `<div class="cards">${cards}<button class="tcard new" data-new><b>+</b>Nowy motyw<small>na bazie wybranego</small></button></div>
    ${group('Windows', `
      <p class="note">Przy pierwszym „Zastosuj” Prism zapisuje kopię Twoich ustawień. Przycisk niżej przywraca dokładnie ten stan.</p>
      <div class="btns">
        <button class="btn ghost danger" data-restore ${st.state?.hasBackup && !st.busy ? '' : 'disabled'}>Przywróć oryginalny Windows</button>
        ${selMeta && !selMeta.builtIn ? `<button class="btn ghost" data-deltheme>Usuń motyw „${esc(selMeta.theme.name)}”</button>` : ''}
      </div>
      ${st.state && !st.state.isWin ? '<p class="note warn">Zmiany systemu działają tylko w Windows 11. Tutaj możesz tworzyć i zapisywać motywy.</p>' : ''}`)}`;
}
function secColors() {
  return group('Tryb', seg('colors.mode', [['dark', 'Ciemny'], ['light', 'Jasny']]) + '<p class="note">Tryb Windowsa i aplikacji.</p>')
    + group('Paleta', `<div class="crows">${Object.keys(COLOR_NAMES).map(k => colorRow('colors.' + k, COLOR_NAMES[k], COLOR_HINTS[k])).join('')}</div>
      <div class="btns"><button class="btn ghost" data-harmony>Dobierz resztę do akcentu</button></div>`)
    + group('Efekty', toggle('effects.transparency', 'Przezroczystość Windows', 'Pasek zadań, menu Start i okna systemowe prześwitują.')
      + range('effects.opacity', 'Krycie terminala', 0, 100, '%')
      + toggle('effects.blur', 'Rozmycie pulpitu za terminalem', 'Windows 11. Zmienia się po ponownym uruchomieniu Prism.')
      + range('effects.radius', 'Zaokrąglenie okna Prism', 0, 24, ' px'))
    + group('Czcionka terminala', `<div class="field">${label('Nazwa czcionki', 'Musi być zainstalowana, np. Cascadia Code, JetBrains Mono, Consolas')}<input type="text" data-d="fonts.mono" value="${esc(dget('fonts.mono'))}" spellcheck="false"></div>`
      + range('fonts.size', 'Rozmiar', 10, 24, ' px'));
}
function secWallpaper() {
  const type = dget('wallpaper.type');
  if (!st.draft.wallpaper) st.draft.wallpaper = { type };
  if (type === 'gradient' && (st.draft.wallpaper.colors || []).length < 2) st.draft.wallpaper.colors = [st.draft.colors.background, st.draft.colors.accent];
  let body = '';
  if (type === 'gradient') {
    const cols = (st.draft.wallpaper?.colors || []).map(c => color(st.draft, c, '#000000'));
    body = group('Kolory gradientu', `<div class="stops">${cols.map((c, i) => `<div class="stop"><input type="color" data-stop="${i}" value="${c}" aria-label="Kolor ${i + 1}"><input class="hex" data-stop="${i}" value="${c}" maxlength="7" aria-label="Kolor ${i + 1} (hex)"><button class="ic sm" data-rmstop="${i}" ${cols.length <= 2 ? 'disabled' : ''} aria-label="Usuń kolor">✕</button></div>`).join('')}</div>
      <div class="btns"><button class="btn ghost" data-addstop ${cols.length >= 8 ? 'disabled' : ''}>+ Dodaj kolor</button><button class="btn ghost" data-shuffle>Losuj z palety</button></div>`)
      + group('Kierunek', range('wallpaper.angle', 'Kąt', 0, 360, '°'));
  } else if (type === 'image') {
    const p = st.draft.wallpaper?.path || '';
    body = group('Obraz', `<div class="field">${label('Plik', p ? esc(p.split(/[\\/]/).pop()) : 'JPG albo PNG, najlepiej w rozdzielczości ekranu')}<input type="file" accept="image/png,image/jpeg,image/webp,image/bmp" data-wpfile></div>
      <p class="note">Przy zapisie motywu Prism skopiuje obraz obok pliku motywu.</p>`);
  } else body = group('', '<p class="note">Prism nie zmieni tapety.</p>');
  return group('Rodzaj', seg('wallpaper.type', [['gradient', 'Gradient'], ['image', 'Obraz'], ['none', 'Bez zmian']])) + body;
}
function secWindows() {
  const tiling = dget('windows.tiling');
  return group('Układ', toggle('windows.tiling', 'Kafelkowanie okien', 'Okna same układają się obok siebie. Alt+strzałki zmieniają okno, Alt+1…9 pulpity. Instaluje GlazeWM.')
      + (tiling ? range('windows.gaps.inner', 'Odstęp między oknami', 0, 40, ' px') + range('windows.gaps.outer', 'Odstęp od krawędzi ekranu', 0, 60, ' px') : ''))
    + group('Ramki i rogi', `${tiling ? '' : '<p class="note warn">Ramki, rogi, ukrywanie pasków tytułu i przezroczystość okien działają razem z kafelkowaniem (GlazeWM). Włącz je wyżej.</p>'}
      <div class="${tiling ? '' : 'dim'}" style="display:grid;gap:14px">
      ${toggle('windows.border.enabled', 'Kolorowa ramka okien')}
      ${refSel('windows.border.focused', 'Ramka aktywnego okna')}
      ${refSel('windows.border.inactive', 'Ramka pozostałych okien')}
      <div class="field"><span>Rogi okien</span>${seg('windows.corners', [['rounded', 'Zaokrąglone'], ['small_rounded', 'Lekko'], ['square', 'Kwadratowe']])}</div>
      ${toggle('windows.hideTitleBar', 'Ukryj paski tytułu', 'Czystszy wygląd. Niektóre aplikacje mogą wtedy wyglądać dziwnie.')}
      ${range('windows.inactiveOpacity', 'Krycie nieaktywnych okien', 30, 100, '%')}</div>`);
}
function secTaskbar() {
  return group('Ikony', seg('taskbar.alignment', [['left', 'Do lewej'], ['center', 'Na środku']]))
    + group('Styl paska', seg('taskbar.windhawk.taskbarStyler', [['', 'Standardowy'], ['DockLike', 'Jak dock'], ['TranslucentTaskbar', 'Półprzezroczysty'], ['SimplyTransparent', 'Przezroczysty']])
      + '<p class="note">Styl paska ustawia darmowy Windhawk z modem „Windows 11 Taskbar Styler”. Po zastosowaniu motywu Prism go zainstaluje i podpowie, co wybrać. Automatyczne ustawianie pojawi się w kolejnej wersji.</p>');
}

// ---------- podgląd pulpitu ----------
function wallCss(t) {
  const wp = t.wallpaper || {}, bg = t.colors?.background || '#101216';
  if (wp.type === 'gradient' && (wp.colors || []).length > 1) return `linear-gradient(${((wp.angle ?? 90) + 90) % 360}deg, ${wp.colors.map(x => color(t, x, bg)).join(', ')})`;
  if (wp.type === 'none') return 'linear-gradient(160deg, #1d3a63, #4e78b0 55%, #9cb8d8)';
  return '';
}
function desk(t, mini) {
  const c = t.colors || {}, bg = c.background || '#101216', sf = c.surface || bg, tx = c.text || '#eee', mu = c.muted || tx, ac = c.accent || '#7aa7ff', a2 = c.accent2 || ac;
  const w = t.windows || {}, tiling = !!w.tiling, gi = w.gaps?.inner ?? 10, go_ = w.gaps?.outer ?? 12;
  const rad = ({ rounded: 8, small_rounded: 4, square: 0 }[w.corners || 'rounded'] ?? 8) * (mini ? .6 : 1);
  const bOn = tiling && w.border?.enabled !== false;
  const fb = color(t, w.border?.focused || 'accent', ac), ib = color(t, w.border?.inactive || 'surface', sf);
  const inOp = tiling ? (w.inactiveOpacity ?? 100) / 100 : 1, op = (t.effects?.opacity ?? 80) / 100;
  const W = 1920, H = 1200, TB = 48, pct = (v, ref) => (v / ref * 100).toFixed(3) + '%';
  let rects;
  if (tiling) {
    const top = go_, left = go_, bottom = H - TB - go_, right = W - go_, mid = left + (right - left - gi) / 2, half = (bottom - top - gi) / 2;
    rects = [[left, top, mid - left, bottom - top, 'term', true], [mid + gi, top, right - mid - gi, half, 'app', false], [mid + gi, top + half + gi, right - mid - gi, half, 'app2', false]];
  } else rects = [[230, 130, 1060, 720, 'app', false], [800, 400, 880, 560, 'term', true]];
  const hide = tiling && w.hideTitleBar;
  const wins = rects.map(([x, y, ww, hh, kind, focus]) => {
    const term = kind === 'term';
    const body = term
      ? `<div class="mbody">${[[ac, tx, 46], [null, mu, 70], [null, a2, 38], [ac, tx, 24]].map(([p, col, wd]) => `<div class="ml">${p ? `<b style="color:${p}">❯</b>` : ''}<span style="background:${col};width:${wd}%"></span></div>`).join('')}</div>`
      : `<div class="mapp"><div class="side" style="background:${hexA(bg, .35)}">${[60, 80, 50, 70].map(x => `<span style="background:${mu};width:${x}%"></span>`).join('')}</div><div class="main">${[ac, a2, mu, sf].map(col => `<span style="background:${hexA(col, kind === 'app2' ? .5 : .75)}"></span>`).join('')}</div></div>`;
    return `<div class="mw" style="left:${pct(x, W)};top:${pct(y, H)};width:${pct(ww, W)};height:${pct(hh, H)};border-radius:${rad}px;border-color:${bOn ? (focus ? fb : ib) : 'rgba(255,255,255,.1)'};opacity:${focus ? 1 : inOp};background:${term ? hexA(bg, op) : c.mode === 'light' ? '#fafafa' : sf};color:${tx}">${hide ? '' : `<div class="mt" style="background:${term ? 'transparent' : hexA(bg, .25)}"><i></i><i></i><i></i></div>`}${body}</div>`;
  }).join('');
  const tb = t.taskbar || {}, style = tb.windhawk?.taskbarStyler || '', dock = style === 'DockLike', clear = /Transparent/.test(style);
  const icons = [ac, a2, mu, tx, ac].map(col => `<i style="background:${col}"></i>`).join('');
  const tbBg = clear ? (style === 'SimplyTransparent' ? 'transparent' : hexA(sf, .35)) : hexA(sf, t.effects?.transparency === false ? 1 : .8);
  const bar = dock ? `<div class="mtb dock" style="background:${hexA(sf, .55)}">${icons}</div>`
    : `<div class="mtb ${tb.alignment === 'left' ? 'left' : 'center'}" style="background:${tbBg}">${icons}<span class="clock" style="color:${tx}">12:34</span></div>`;
  const wall = wallCss(t);
  return `<div class="desk${mini ? ' mini' : ''}" style="background:${wall || '#22252c'}">${wall ? '' : '<div class="wpimg">Twój obraz</div>'}${wins}${bar}</div>`;
}
function termPreview() {
  const L = P.S.look, A = P.ANSI[L.ansi] || P.ANSI.dark, cur = `<span class="cur-${L.cursor}" style="background:${L.accent}"></span>`;
  const pr = `<span style="color:${L.accent}">PS C:\\Users\\ty&gt;</span>`;
  return `<div class="tpv" style="background:${wallCss(st.draft) || '#22252c'}"><div class="tpw" style="background:${hexA(L.bg, L.opacity / 100)};color:${L.fg};font-family:${esc(L.font)};font-size:${Math.min(L.size, 16)}px;line-height:${L.lineHeight};border-radius:${L.radius}px;padding:${Math.min(L.padding, 24)}px">${pr} hej Ola
Cześć Ola! Jest 12:34, miłego dnia.
${pr} git status
<span style="color:${A.green}">On branch main</span>
  <span style="color:${A.red}">modified:   README.md</span>
  <span style="color:${A.yellow}">new file:   motyw.json</span>
${pr} ${cur}</div></div>`;
}
function previewFoot() {
  const meta = st.themes.find(t => t.id === st.sel);
  return `<div class="pfoot">
    <label><span>Nazwa motywu</span><input type="text" data-d="name" value="${esc(st.draft.name)}"></label>
    <div class="pstatus">${statusHtml()}</div>
    <div class="pbtns"><button class="btn ghost" data-save ${st.dirty || !meta ? '' : 'disabled'}>Zapisz</button>
      <button class="btn" data-apply ${st.busy ? 'disabled' : ''}>${st.busy ? '<span class="spin"></span>Stosuję…' : 'Zastosuj w Windows'}</button></div>
    ${st.log ? `<details class="log" ${st.logOpen ? 'open' : ''}><summary>Szczegóły</summary><pre>${esc(st.log)}</pre></details>` : ''}
  </div>`;
}
function statusHtml() {
  const meta = st.themes.find(t => t.id === st.sel);
  if (st.dirty) return `<span class="d warn"></span>Niezapisane zmiany${meta?.builtIn ? ' (zapiszą się jako Twój motyw)' : ''}`;
  if (st.state?.current?.id === st.sel) return '<span class="d ok"></span>Aktywny w Windows';
  return '<span class="d"></span>Nie zastosowany';
}
function renderPreview() {
  const s = SEC(st.section);
  if (!s.pv) { $('#sPreview').innerHTML = ''; return; }
  $('#sPreview').innerHTML = s.pv === 'term' ? termPreview() : `<div class="dwrap">${desk(st.draft, false)}</div>${previewFoot()}`;
}
function updatePreview() {
  const s = SEC(st.section);
  if (s.pv === 'term') { $('#sPreview').innerHTML = termPreview(); return; }
  const dw = $('#sPreview .dwrap');
  if (dw) dw.innerHTML = desk(st.draft, false);
  const ps = $('#sPreview .pstatus'); if (ps) ps.innerHTML = statusHtml();
  const sv = $('#sPreview [data-save]'); if (sv) sv.disabled = !st.dirty && !!st.themes.find(t => t.id === st.sel);
  if (st.section === 'theme') { const on = $(`.tcard.on`); if (on) { const m = on.querySelector('.desk'); if (m) m.outerHTML = desk(st.draft, true); } }
}

// ---------- terminal i komendy ----------
function secTerminal() {
  const L = P.S.look;
  return group('Gotowe kolory', `<div class="presets">${P.PRESETS.map(p => `<button class="pre${L.preset === p.id ? ' on' : ''}" data-preset="${p.id}" style="background:${p.bg};color:${p.fg}"><span style="color:${p.accent}">❯</span> ${p.n}</button>`).join('')}</div>`)
    + group('Przezroczystość i kolory', range('opacity', 'Krycie tła', 0, 100, '%', 1, 'data-l', L.opacity)
      + `<div class="crows">${colorRow('bg', 'Tło', '', 'data-l', L.bg)}${colorRow('fg', 'Tekst', '', 'data-l', L.fg)}${colorRow('accent', 'Akcent', 'kursor i zaznaczenie', 'data-l', L.accent)}</div>`
      + `<div class="field"><span>Kolory poleceń (ANSI)</span>${seg('ansi', [['dark', 'Do ciemnego tła'], ['light', 'Do jasnego tła']], 'data-lseg', L.ansi)}</div>`)
    + group('Tekst', `<div class="field">${label('Czcionka', 'Lista czcionek CSS, np. "Cascadia Code", Consolas, monospace')}<input type="text" data-l="font" value="${esc(L.font)}" spellcheck="false"></div>`
      + range('size', 'Rozmiar', 10, 28, ' px', 1, 'data-l', L.size) + range('lineHeight', 'Wysokość linii', 1, 1.8, '', .05, 'data-l', L.lineHeight))
    + group('Okno', range('padding', 'Margines', 0, 40, ' px', 1, 'data-l', L.padding) + range('radius', 'Zaokrąglenie okna', 0, 24, ' px', 1, 'data-l', L.radius)
      + `<div class="field"><span>Kursor</span>${seg('cursor', [['block', 'Blok'], ['bar', 'Kreska'], ['underline', 'Podkreślenie']], 'data-lseg', L.cursor)}</div>`
      + toggle('blink', 'Migający kursor', '', 'data-lb', L.blink))
    + group('Powłoka i system', `<div class="field"><span>Domyślna powłoka nowych kart</span><select data-prof>${P.profiles.map(p => `<option value="${esc(p.id)}" ${p.id === (P.S.defaultProfile || P.profiles[0]?.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`
      + toggle('desktopBlur', 'Rozmycie pulpitu za oknem', P.acrylic ? 'Działa po ponownym uruchomieniu Prism.' : 'Twój system tego nie obsługuje (Windows 11 i macOS).', 'data-blur', P.S.desktopBlur)
      + '<div class="btns"><button class="btn ghost" data-relaunch>Uruchom Prism ponownie</button></div>');
}
let editing = null;
function secCommands() {
  const list = P.S.commands.length ? P.S.commands.map((c, i) => `<li><b>${esc(c.name)}</b><button data-ce="${i}">Edytuj</button><button data-cd="${i}">Usuń</button><small>${esc(c.desc || (c.type === 'run' ? '▸ ' : '') + c.body.split('\n')[0])}</small></li>`).join('')
    : '<li class="empty">Nie masz jeszcze własnych komend.</li>';
  const c = editing != null ? P.S.commands.find(x => x.name === editing) : null;
  return group('Twoje komendy', `<ul class="cmds">${list}</ul><p class="note">Szybciej z terminala: <code class="k">dodaj-komende hej "Cześć {1}!"</code></p>`)
    + group(c ? `Edycja: ${esc(c.name)}` : 'Nowa komenda', `<form id="cmdForm" style="display:grid;gap:14px">
      <div class="field"><span>Nazwa</span><input type="text" id="cName" value="${esc(c?.name || '')}" placeholder="np. projekt" spellcheck="false" autocapitalize="off" required></div>
      <div class="field"><span>Co robi</span>${seg('cType', [['text', 'Wypisuje tekst'], ['run', 'Uruchamia polecenia']], 'data-ctype', c?.type || 'text')}</div>
      <div class="field">${label('Treść', 'Zmienne: {1} {2}… to argumenty, {args} wszystkie, {date}, {time}, {user}. Polecenia oddzielaj średnikiem.')}<textarea id="cBody" spellcheck="false" required placeholder="cd ~/projekty/strona; code .">${esc(c?.body || '')}</textarea></div>
      <div class="field"><span>Opis (opcjonalnie)</span><input type="text" id="cDesc" value="${esc(c?.desc || '')}"></div>
      <p class="err" id="cErr"></p>
      <div class="btns"><button class="btn" type="submit">Zapisz komendę</button>${c ? '<button class="btn ghost" type="button" data-ccancel>Anuluj</button>' : ''}</div></form>`);
}
function secAbout() {
  const k = P.MAC ? { t: 'Cmd+T', w: 'Cmd+W', c: 'Cmd+C', v: 'Cmd+V', s: 'Cmd+,', z: 'Cmd+= / Cmd+−' } : { t: 'Ctrl+Shift+T', w: 'Ctrl+Shift+W', c: 'Ctrl+Shift+C', v: 'Ctrl+V', s: 'Ctrl+,', z: 'Ctrl+= / Ctrl+−' };
  const rows = [['Ustawienia', k.s + ' albo <code class="k">settings</code>'], ['Nowa karta', k.t], ['Zamknij kartę', k.w], ['Przełącz kartę', 'Ctrl+Tab, Alt+1…9'], ['Kopiuj', k.c + ' albo prawy przycisk'], ['Wklej', k.v + ' albo prawy przycisk'], ['Rozmiar czcionki', k.z]];
  return group('Prism', `<p class="note">Wersja ${esc(st.state?.version || '')}. Terminal i centrum sterowania wyglądem Windowsa.</p>
      <div class="btns"><button class="btn" data-tourreset>Pokaż samouczek od nowa</button><button class="btn ghost" data-link="https://github.com/onufry444/prism">Strona projektu na GitHubie</button></div>`)
    + group('Skróty', `<table class="keys">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`)
    + group('Z wiersza poleceń', `<table class="keys">
      <tr><td><code class="k">prism update</code></td><td>aktualizacja do najnowszej wersji</td></tr>
      <tr><td><code class="k">prism apply kafel</code></td><td>motyw bez otwierania ustawień</td></tr>
      <tr><td><code class="k">prism restore</code></td><td>oryginalny wygląd Windows</td></tr>
      <tr><td><code class="k">prism uninstall</code></td><td>usuwa Prism (najpierw przywraca Windows)</td></tr></table>`);
}

// ---------- akcje ----------
const slug = s => (s || '').toLowerCase().replace(/[ąćęłńóśźż]/g, ch => 'acelnoszz'['ąćęłńóśźż'.indexOf(ch)]).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'moj-motyw';
function uniqueId(base) {
  let id = base.length < 2 ? 'motyw-' + base : base, n = 2;
  const taken = x => st.themes.some(t => t.id === x && (t.builtIn || t.id !== st.sel));
  while (taken(id)) id = `${base}-${n++}`;
  return id;
}
async function saveDraft() {
  const d = clone(st.draft), meta = st.themes.find(t => t.id === st.sel);
  d.name = (d.name || '').trim() || 'Mój motyw';
  if (!meta || meta.builtIn) {
    if (meta && d.name === meta.theme.name) d.name += ' (mój)';
    d.id = uniqueId(slug(d.name));
    d.author = 'Ty';
  }
  const r = await api.themes.save(d);
  if (!r.ok) { P.toast(r.error); return null; }
  st.themes = await api.themes.list();
  st.sel = r.theme.id; st.draft = clone(r.theme); st.dirty = false;
  if (st.section === 'theme') renderSection();
  renderPreview();
  P.toast(`Zapisano motyw „${r.theme.name}”`);
  return r;
}
async function applyDraft() {
  if (st.busy) return;
  let meta = st.themes.find(t => t.id === st.sel);
  if (st.dirty || !meta) {
    const r = await saveDraft();
    if (!r) return;
    meta = st.themes.find(t => t.id === r.theme.id) || { id: r.theme.id, path: r.path, theme: r.theme, builtIn: false };
  }
  st.busy = true; st.log = ''; st.logOpen = false;
  renderPreview();
  const r = await api.prismRun('apply', meta.path);
  st.busy = false;
  st.state = await api.prismState();
  if (r.code === 0) { P.toast(`Zastosowano „${meta.theme.name}”`); P.tourDone('apply'); renderTourBar(); }
  else { st.logOpen = true; if (r.error) st.log += r.error; P.toast(r.error || 'Coś poszło nie tak. Zobacz szczegóły.'); }
  if (st.section === 'theme') renderSection();
  renderPreview();
}
async function restoreWindows() {
  if (!confirm('Przywrócić oryginalny wygląd Windows (kolory, tapetę, kafelkowanie) z kopii zapisanej przy pierwszym motywie?')) return;
  st.busy = true; st.log = ''; renderSection(); renderPreview();
  const r = await api.prismRun('restore');
  st.busy = false;
  st.state = await api.prismState();
  P.toast(r.code === 0 ? 'Przywrócono oryginalny Windows' : (r.error || 'Nie udało się przywrócić. Zobacz szczegóły.'));
  if (r.code !== 0) st.logOpen = true;
  renderSection(); renderPreview();
}
api.onPrismLog(d => {
  st.log += d;
  const pre = $('#sPreview .log pre');
  if (pre) { pre.textContent = st.log; pre.scrollTop = pre.scrollHeight; }
  else if (SEC(st.section).pv === 'desk' && !$('#sPreview .log')) renderPreview();
});
function harmony() {
  const [r, g, b] = P.rgb(st.draft.colors.accent), dark = st.draft.colors.mode !== 'light';
  const mix = (t, a) => '#' + [r, g, b].map((v, i) => Math.round(v * a + t[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
  const base = dark ? [14, 15, 20] : [246, 244, 240], ink = dark ? [236, 234, 228] : [28, 28, 32];
  Object.assign(st.draft.colors, { background: mix(base, .08), surface: mix(base, .16), text: mix(ink, .06), muted: mix(dark ? [130, 132, 142] : [110, 108, 104], .15), accent2: '#' + [b, r, g].map(v => v.toString(16).padStart(2, '0')).join('') });
  st.dirty = true; renderSection(); updatePreview();
}
function shuffleWall() {
  const pool = ['background', 'surface', 'accent', 'accent2', 'muted'].map(k => st.draft.colors[k]).filter(Boolean);
  const pick = [...pool].sort(() => Math.random() - .5).slice(0, 2 + Math.floor(Math.random() * 2));
  set(st.draft, 'wallpaper.colors', [st.draft.colors.background, ...pick.filter(c => c !== st.draft.colors.background)].slice(0, 4));
  if (st.draft.wallpaper.colors.length < 2) st.draft.wallpaper.colors.push(st.draft.colors.accent);
  set(st.draft, 'wallpaper.angle', Math.round(Math.random() * 360));
  st.dirty = true; renderSection(); updatePreview();
}

// ---------- zdarzenia ----------
const root = $('#settings');
root.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.s) return go(d.s);
  if (b.id === 'sClose') return P.closeSettings();
  if (d.theme) {
    if (d.theme === st.sel) return;
    if (st.dirty && !confirm('Masz niezapisane zmiany w motywie. Porzucić je?')) return;
    select(d.theme); renderSection(); renderPreview(); return;
  }
  if ('new' in d) { const base = clone(st.draft); base.name = 'Mój motyw'; base.description = ''; st.draft = base; st.sel = null; st.dirty = true; return go('colors'); }
  if ('restore' in d) return restoreWindows();
  if ('deltheme' in d) {
    const meta = st.themes.find(t => t.id === st.sel);
    if (!meta || !confirm(`Usunąć motyw „${meta.theme.name}”?`)) return;
    const r = await api.themes.remove(meta.id);
    if (!r.ok) return P.toast(r.error);
    await loadThemes(); select(st.themes[0]?.id); renderSection(); renderPreview(); return;
  }
  if ('save' in d) return saveDraft();
  if ('apply' in d) return applyDraft();
  if (d.seg) { setDraft(d.seg, d.v === 'true' ? true : d.v === 'false' ? false : d.v); renderSection(); return; }
  if (d.lseg) { P.setLook({ [d.lseg]: d.v }, d.lseg !== 'cursor'); renderSection(); updatePreview(); return; }
  if (d.ctype) { b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); return; }
  if (d.preset) { P.usePreset(d.preset); renderSection(); updatePreview(); return; }
  if ('harmony' in d) return harmony();
  if ('addstop' in d) { const cols = st.draft.wallpaper.colors; cols.push(st.draft.colors.accent2 || st.draft.colors.accent); st.dirty = true; renderSection(); updatePreview(); return; }
  if (d.rmstop) { st.draft.wallpaper.colors.splice(+d.rmstop, 1); st.dirty = true; renderSection(); updatePreview(); return; }
  if ('shuffle' in d) return shuffleWall();
  if ('relaunch' in d) return api.win('relaunch');
  if ('tourreset' in d) { P.S.onboarding = { ...P.S.onboarding, done: [], hidden: false }; P.save(); P.closeSettings(); P.toast('Samouczek zaczyna się od nowa'); return; }
  if (d.link) return api.openExternal(d.link);
  if (d.ce) { editing = P.S.commands[+d.ce]?.name; renderSection(); $('#cName')?.focus(); return; }
  if (d.cd) { const c = P.S.commands[+d.cd]; P.S.commands.splice(+d.cd, 1); P.save(true); if (editing === c.name) editing = null; renderSection(); P.toast(`Usunięto ${c.name}`); return; }
  if ('ccancel' in d) { editing = null; renderSection(); }
});
root.addEventListener('input', e => {
  const el = e.target, d = el.dataset;
  const val = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
  if (el.classList.contains('hex') && !HEX.test(val)) return;
  const pair = key => root.querySelectorAll(`[${key}="${d[key.slice(5)] ?? ''}"]`).forEach(x => { if (x !== el && x.type !== 'checkbox') x.value = val; });
  if (d.d) {
    if (d.d === 'name') { st.draft.name = val; st.dirty = true; updatePreview(); return; }
    setDraft(d.d, val);
    pair('data-d');
    if (d.d === 'wallpaper.type' || d.re) renderSection();
  } else if (d.stop !== undefined) {
    st.draft.wallpaper.colors[+d.stop] = val; st.dirty = true; pair('data-stop'); updatePreview();
  } else if (d.l) {
    P.setLook({ [d.l]: val }, ['bg', 'fg', 'accent', 'opacity'].includes(d.l) && d.l !== 'opacity');
    if (d.l === 'opacity') P.tourDone('opacity');
    pair('data-l'); updatePreview();
  } else if (d.lb) { P.setLook({ [d.lb]: val }, false); updatePreview(); }
  const out = root.querySelector(`output[data-out="${d.d || d.l}"]`);
  if (out && el.type === 'range') out.textContent = fmt(val, +el.step || 1) + out.dataset.unit;
});
root.addEventListener('change', e => {
  const el = e.target, d = el.dataset;
  if ('prof' in d) { P.S.defaultProfile = el.value; P.save(true); }
  else if ('blur' in d) { P.S.desktopBlur = el.checked; P.save(true); P.toast('Rozmycie zmieni się po ponownym uruchomieniu Prism'); }
  else if ('wpfile' in d && el.files[0]) {
    const p = api.pathForFile(el.files[0]);
    if (!p) return P.toast('Nie mogę odczytać ścieżki pliku');
    setDraft('wallpaper.path', p); renderSection();
  }
});
root.addEventListener('submit', e => {
  if (e.target.id !== 'cmdForm') return;
  e.preventDefault();
  const name = $('#cName').value.trim(), type = root.querySelector('[data-ctype].on')?.dataset.v || 'text';
  try {
    P.upsertCmd({ name, type, body: $('#cBody').value, desc: $('#cDesc').value.trim() }, editing);
    P.toast(`Komenda ${name} zapisana. Wpisz ją w terminalu.`);
    editing = null; renderSection();
  } catch (err) { $('#cErr').textContent = err.message; }
});
document.addEventListener('keydown', e => {
  if (root.hidden) return;
  if (e.key === 'Escape' && !e.target.closest('textarea')) { e.preventDefault(); P.closeSettings(); }
  else if ((P.MAC ? e.metaKey : e.ctrlKey) && e.key === ',') { e.preventDefault(); P.closeSettings(); }
});
P.on('commands', () => { if (!root.hidden && st.section === 'commands') renderSection(); });
P.on('settings', () => { if (!root.hidden && st.section === 'terminal') { renderSection(); updatePreview(); } });
P.on('tour', () => { if (!root.hidden) renderTourBar(); });
}
