'use strict';
// Prism settings, opened with `settings` in the terminal (or Ctrl+,). Everything works with the mouse.
// Changes apply live and are saved to the settings layer. Values set in ~/.config/prism/config.jsonc win and are marked.
{
const P = window.Prism, { api, $, esc, hexA } = P;
const HEX = /^#[0-9a-f]{6}$/i;
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function set(o, p, v) { const ks = p.split('.'); let c = o; for (const k of ks.slice(0, -1)) { if (c[k] == null || typeof c[k] !== 'object') c[k] = {}; c = c[k]; } c[ks[ks.length - 1]] = v; }
const patchOf = (p, v) => { const o = {}; set(o, p, v); return o; };

const ICON = {
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12.5 15H17"/>',
  shell: '<path d="M4 17l6-5-6-5M12 19h8"/>',
  admin: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  aliases: '<path d="M9 5H7a2 2 0 0 0-2 2v3l-2 2 2 2v3a2 2 0 0 0 2 2h2M15 5h2a2 2 0 0 1 2 2v3l2 2-2 2v3a2 2 0 0 1-2 2h-2"/>',
  keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  files: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/>'
};
const SECTIONS = [
  { id: 'terminal', name: 'Appearance', sub: 'Colors, transparency, font and window. Changes apply immediately.', pv: 'term' },
  { id: 'shell', name: 'Shell & prompt', sub: 'Default shell, command translation, Linux commands and the prompt.', pv: 'prompt' },
  { id: 'admin', name: 'Administrator', sub: 'Run Prism as a normal user. When a command needs admin rights, Prism asks and runs just that command elevated.', pv: null },
  { id: 'aliases', name: 'Aliases', sub: 'Your own commands. They work in every shell, with arguments and pipes.', pv: null },
  { id: 'keys', name: 'Keyboard', sub: 'Shortcuts. Click a field and press the keys you want.', pv: null },
  { id: 'files', name: 'Config files', sub: 'Prefer text files? Everything here can be set in config.jsonc and styled with style.css. They reload when you save.', pv: null },
  { id: 'about', name: 'About', sub: '', pv: null }
];
P.sectionIds = SECTIONS.map(s => s.id);
const SEC = id => SECTIONS.find(s => s.id === id);
const ALIAS = { appearance: 'terminal', look: 'terminal', colors: 'terminal', theme: 'terminal', themes: 'terminal', font: 'terminal', cmd: 'aliases', commands: 'aliases', alias: 'aliases', prompt: 'shell', translate: 'shell', sudo: 'admin', elevation: 'admin', config: 'files', keyboard: 'keys', shortcuts: 'keys' };
const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const SEGMENTS = { userhost: 'user@host', path: 'Folder', git: 'Git branch', venv: 'Python venv', duration: 'Command time', status: 'Exit status', time: 'Clock', shell: 'Shell name' };
const KEYS = { newTab: 'New tab', closeTab: 'Close tab', nextTab: 'Next tab', prevTab: 'Previous tab', newWindow: 'New window', settings: 'Settings', search: 'Find', copy: 'Copy', paste: 'Paste', zoomIn: 'Bigger text', zoomOut: 'Smaller text', zoomReset: 'Reset text size', toggleWindow: 'Show/hide Prism from anywhere' };
const PV_BG = 'linear-gradient(135deg, #2b3245, #1b1e28 55%, #2a2236)';

const st = { section: 'terminal', editing: null };
const over = p => (P.C.overridden || []).some(o => o === p || o.startsWith(p + '.') || p.startsWith(o + '.'));
let liveT = null;
function setLive(p, v, now) {
  set(P.cfg, p, v); // optimistic, so the preview updates at once
  clearTimeout(liveT);
  const send = () => P.set(patchOf(p, v));
  if (now) send(); else liveT = setTimeout(send, 140);
  updatePreview();
}

// ---------- open / close ----------
P.openSettings = sec => {
  const el = $('#settings'), was = el.hidden;
  el.hidden = false;
  const s = String(sec || '').trim().toLowerCase();
  go(ALIAS[s] || (SEC(s) ? s : was ? 'terminal' : st.section));
};
P.closeSettings = () => { if ($('#settings').hidden) return; $('#settings').hidden = true; P.active?.term.focus(); };
P.toggleSettings = () => ($('#settings').hidden ? P.openSettings() : P.closeSettings());
P.goSection = s => go(s);

// ---------- render ----------
function go(sec) {
  st.section = SEC(sec) ? sec : 'terminal';
  const s = SEC(st.section);
  $('#sNav').innerHTML = SECTIONS.map(x => `<button class="nb${x.id === st.section ? ' on' : ''}" data-s="${x.id}"><svg viewBox="0 0 24 24">${ICON[x.id]}</svg>${x.name}</button>`).join('')
    + '<div class="hint"><kbd>Esc</kbd> back to the terminal</div>';
  $('#sTitle').textContent = s.name;
  $('#sSub').textContent = s.id === 'about' ? `Version ${P.version}` : s.sub;
  $('#settings').classList.toggle('nopv', !s.pv);
  $('#sNote').innerHTML = P.C.error ? `<div class="notice err">${esc(P.C.error)}</div>` : '';
  renderSection();
  updatePreview();
  $('#sMain').scrollTop = 0;
}
function renderSection() {
  const R = { terminal: secTerminal, shell: secShell, admin: secAdmin, aliases: secAliases, keys: secKeys, files: secFiles, about: secAbout };
  $('#sContent').innerHTML = R[st.section]();
}
function updatePreview() {
  const s = SEC(st.section);
  $('#sPreview').innerHTML = s.pv === 'term' ? termPreview() : s.pv === 'prompt' ? promptPreview() : '';
}

// ---------- controls (data-c = live config) ----------
const group = (title, body) => `<div class="group">${title ? `<h3>${title}</h3>` : ''}${body}</div>`;
const label = (t, hint) => `<span>${t}${hint ? `<small>${hint}</small>` : ''}</span>`;
const lock = p => over(p) ? ' <em class="lock" title="Set in config.jsonc, which wins over Settings">config.jsonc</em>' : '';
const val = (attr, p) => get(P.cfg, p);
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
const chips = (p, all, selected) => `<div class="chips">${Object.entries(all).map(([k, l]) => `<button class="chip${selected.includes(k) ? ' on' : ''}" data-chips="${p}" data-v="${k}" ${over(p) ? 'disabled' : ''}>${selected.includes(k) ? `<i>${selected.indexOf(k) + 1}</i>` : ''}${l}</button>`).join('')}</div>`;


// ---------- previews ----------
function termPreview() {
  const t = P.cfg.terminal, c = P.palette(), cur = `<span class="cur-${t.cursor}" style="background:${c.accent}"></span>`;
  const pr = `<span style="color:${c.blue};font-weight:700">~/projects/prism</span> <span style="color:${c.magenta}"> main</span>\n<span style="color:${c.green}">❯</span>`;
  return `<div class="tpv" style="background:${PV_BG}"><div class="tpw" style="background:${hexA(c.background, t.opacity / 100)};color:${c.foreground};font-family:${esc(t.font)};font-size:${Math.min(t.fontSize, 15)}px;line-height:${t.lineHeight};border-radius:${t.radius}px;padding:${Math.min(t.padding, 22)}px">${pr} ls -la
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
  return `<div class="tpv" style="background:${PV_BG}"><div class="tpw" style="background:${hexA(tc.background, P.cfg.terminal.opacity / 100)};color:${tc.foreground};font-family:${esc(P.cfg.terminal.font)};font-size:14px;line-height:1.45;padding:16px;border-radius:${P.cfg.terminal.radius}px">${p.newline ? `${line}\n${sym} npm test` : `${line} ${sym} npm test`}</div></div>
    ${P.translateAvailable ? '' : '<p class="note">Command translation runs in the Prism shell on Windows.</p>'}`;
}

// ---------- sections ----------
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
function secAdmin() {
  const a = P.cfg.admin, elevated = P.elevated;
  return (elevated ? '<div class="notice">Prism itself is running as administrator, so every command already has admin rights. Start Prism normally to get the safer per-command flow below.</div>' : '')
    + group('Asking for admin rights', toggle('data-c', 'admin.ask', 'Offer to retry as admin', 'When a command fails with “Access denied” or “requires elevation”, or it is a tool that always needs admin (sfc, DISM, choco, diskpart…), Prism asks before running it again elevated.')
      + seg('data-c', 'admin.mode', [['inline', 'In this tab'], ['window', 'In a new window']], 'Where elevated commands run')
      + '<p class="note">In this tab: the output and input stay in the tab you typed in, like <code class="k">sudo</code> on Linux. In a new window: the command runs in its own admin console window, which is the more isolated option.</p>')
    + group('By hand', `<table class="keys"><tr><td><code class="k">sudo &lt;command&gt;</code></td><td>run one command as admin (PowerShell, cmd and bash tabs)</td></tr>
      <tr><td><code class="k">sudo !!</code></td><td>run the previous command again as admin</td></tr></table>
      <p class="note">Windows always shows its own UAC prompt first. Prism never stores passwords and never keeps admin rights after the command ends.</p>`);
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
      <tr><td>Accept a suggestion (PowerShell 7)</td><td><code class="k">→</code></td></tr><tr><td>Search history</td><td>type the start, then <code class="k">↑</code></td></tr></table>`);
}
function secFiles() {
  const f = P.C.files || {}, ov = P.C.overridden || [];
  return group('Files', `<table class="keys">
      <tr><td><b>config.jsonc</b><small class="path">${esc(f.config)}</small></td><td><button class="btn ghost" data-open="config">Open</button></td></tr>
      <tr><td><b>style.css</b><small class="path">${esc(f.style)}</small></td><td><button class="btn ghost" data-open="style">Open</button></td></tr>
      <tr><td><b>Config folder</b><small class="path">${esc(f.dir)}</small></td><td><button class="btn ghost" data-open="dir">Open</button></td></tr></table>
      <p class="note">config.jsonc is JSON with comments; anything set there wins over this screen. style.css is loaded into every Prism window (the selectors are listed at the top of the file).</p>`)
    + (P.C.error ? group('Problem', `<p class="note warn">${esc(P.C.error)}</p>`) : '')
    + group('Set in config.jsonc', ov.length ? `<div class="chips">${ov.map(o => `<span class="chip on">${esc(o)}</span>`).join('')}</div>` : '<p class="note">Nothing yet: everything comes from this Settings screen.</p>')
    + group('Shell files', '<p class="note">Prism writes startup files for PowerShell, bash and cmd from your settings. Your own $PROFILE and .bashrc still load first.</p><div class="btns"><button class="btn ghost" data-open="data">Open Prism data folder</button></div>');
}
function secAbout() {
  return group('Prism', `<p class="note">A terminal for Windows that speaks PowerShell, cmd and bash, runs admin commands only when you say so, and is configured like Linux tools: one text file, live reload.</p>
      <div class="btns"><button class="btn ghost" data-link="https://github.com/onufry444/prism">GitHub</button><button class="btn ghost" data-link="https://github.com/onufry444/prism/issues">Report a problem</button></div>`)
    + group('From any terminal', `<table class="keys">
      <tr><td><code class="k">prism</code></td><td>open Prism</td></tr><tr><td><code class="k">prism settings</code></td><td>open these settings</td></tr>
      <tr><td><code class="k">prism update</code></td><td>update Prism</td></tr><tr><td><code class="k">prism uninstall</code></td><td>remove Prism completely</td></tr></table>`);
}

// ---------- events ----------
const root = $('#settings');
root.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.s) return go(d.s);
  if (b.id === 'sClose') return P.closeSettings();
  if (d.cseg) { setLive(d.cseg, d.v, true); renderSection(); return; }
  if (d.chips) {
    const list = [...(get(P.cfg, d.chips) || [])], i = list.indexOf(d.v);
    if (i >= 0) list.splice(i, 1); else list.push(d.v);
    setLive(d.chips, list, true); renderSection(); return;
  }
  if (d.scheme) { P.cfg.terminal.colors = {}; P.cfg.terminal.scheme = d.scheme; await P.set({ terminal: { scheme: d.scheme } }); renderSection(); updatePreview(); return; }
  if ('bgimg' in d) { const p = await api.pickImage(); if (p) { setLive('terminal.backgroundImage', p, true); renderSection(); } return; }
  if ('bgclear' in d) { setLive('terminal.backgroundImage', '', true); renderSection(); return; }
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
  if (d.c && el.tagName !== 'SELECT') {
    const instant = el.type === 'checkbox';
    setLive(d.c, v, instant); pair('data-c', d.c);
    if (instant && d.re) renderSection();
  }
  const out = root.querySelector(`output[data-out="${d.c}"]`);
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
  if (!typing) renderSection();
  updatePreview();
});
}
