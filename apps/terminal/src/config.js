'use strict';
// Prism configuration.
//
// Three layers, later wins:
//   1. DEFAULTS (below)
//   2. settings.json in the app data folder: what you change in the Settings screen
//   3. ~/.config/prism/config.jsonc: your own file, never rewritten by Prism (comments are kept)
// Plus ~/.config/prism/style.css: CSS loaded into the terminal window.
// Both files reload live when saved.
const fs = require('fs');
const path = require('path');
const os = require('os');

const PALETTE = {
  black: '#1b1e28', red: '#ff6b7f', green: '#7ee0b5', yellow: '#ffd27a', blue: '#8ab4ff', magenta: '#c792ea', cyan: '#78dce8', white: '#c9cbd6',
  brightBlack: '#5c6178', brightRed: '#ff8fa0', brightGreen: '#a6f0cf', brightYellow: '#ffe2a6', brightBlue: '#b0ccff', brightMagenta: '#dcb6f2', brightCyan: '#a4ecf4', brightWhite: '#ffffff'
};

const DEFAULTS = {
  terminal: {
    scheme: 'prism',
    opacity: 84,
    blur: true,
    font: '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, monospace',
    fontSize: 14,
    lineHeight: 1.25,
    letterSpacing: 0,
    fontWeight: 'normal',
    cursor: 'bar',
    cursorBlink: true,
    padding: 16,
    radius: 12,
    scrollback: 10000,
    copyOnSelect: false,
    rightClickPaste: true,
    backgroundImage: '',
    backgroundImageOpacity: 0.18,
    colors: {} // your own colors on top of the scheme, e.g. { "background": "#000000", "red": "#ff5555" }
  },
  shell: {
    default: 'prism',
    translate: true,
    translateNotify: true,
    // show system info (fetch) when a new Prism tab opens, like fastfetch in a .bashrc
    fetchOnStart: false,
    linux: true,
    predictions: true
  },
  prompt: {
    style: 'auto',
    segments: ['path', 'git', 'venv', 'duration', 'status'],
    symbol: '❯',
    newline: true,
    blankLine: true,
    unixPaths: true,
    pathDepth: 3,
    gitSymbol: ' ',
    durationMin: 2,
    colors: { path: '#8ab4ff', git: '#c792ea', symbol: '#7ee0b5', error: '#ff6b7f', muted: '#6b7089', user: '#7ee0b5', host: '#8ab4ff' }
  },
  aliases: [
    { name: 'gs', type: 'run', body: 'git status', desc: 'git status' },
    { name: 'gl', type: 'run', body: 'git log --oneline --graph -20', desc: 'short git log' },
    { name: 'mkcd', type: 'run', body: 'mkdir -p {1}; cd {1}', desc: 'make a folder and enter it' }
  ],
  keys: {
    newTab: 'Ctrl+Shift+T', closeTab: 'Ctrl+Shift+W', nextTab: 'Ctrl+Tab', prevTab: 'Ctrl+Shift+Tab',
    settings: 'Ctrl+,', search: 'Ctrl+Shift+F', copy: 'Ctrl+Shift+C', paste: 'Ctrl+Shift+V',
    zoomIn: 'Ctrl+=', zoomOut: 'Ctrl+-', zoomReset: 'Ctrl+0', newWindow: 'Ctrl+Shift+N',
    toggleWindow: 'Ctrl+Alt+T'
  },
  windows: {
    // console apps started anywhere in Windows open in a Prism tab (needs Windows Terminal's console host)
    defaultTerminal: false,
    // "Open in Prism" on folders and "Run in Prism" on programs and scripts in Explorer
    explorerMenu: false
  },
  admin: {
    // ask before running a command that needs administrator rights, then run it elevated
    ask: true,
    // inline: the elevated command runs in the same tab | window: in its own console window
    mode: 'inline'
  },
  // checkUpdates: look for a new version at start and twice a day (Settings > About shows it)
  startup: { launchAtLogin: false, restoreTabs: false, checkUpdates: true }
};

const CONFIG_DIR = path.join(os.homedir(), '.config', 'prism');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.jsonc');
const STYLE_FILE = path.join(CONFIG_DIR, 'style.css');

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }

// JSON with // and /* */ comments and trailing commas (the format waybar and VS Code use).
function parseJsonc(text) {
  let out = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (q) { out += c; if (c === '\\') { out += n ?? ''; i++; } else if (c === '"') q = false; continue; }
    if (c === '"') { q = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { const end = text.indexOf('*/', i + 2); const chunk = text.slice(i, end < 0 ? text.length : end + 2); out += chunk.replace(/[^\n]/g, ' '); i = end < 0 ? text.length : end + 1; continue; }
    out += c;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1').replace(/^\uFEFF/, '');
  if (!out.trim()) return {};
  return JSON.parse(out);
}

// Paths like "terminal.opacity" set in the user file, so Settings can show "set in config.jsonc".
function leafPaths(o, prefix = '', out = []) {
  if (!isObj(o)) return out;
  for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isObj(v)) leafPaths(v, p, out); else out.push(p);
  }
  return out;
}

const CONFIG_TEMPLATE = `// Prism configuration. Anything set here wins over the Settings screen and reloads as soon as you save.
// Remove the // in front of a line to use it. Full reference: https://github.com/onufry444/prism#configuration
{
  // "terminal": {
  //   "scheme": "prism",                // color scheme: prism, tokyo, catppuccin, gruvbox, nord, dracula, solarized-light, paper
  //   "opacity": 84,                    // 0-100, background opacity
  //   "blur": true,                     // blur the desktop behind the window (Windows 11)
  //   "font": "\\"Cascadia Code\\", Consolas, monospace",
  //   "fontSize": 14,
  //   "lineHeight": 1.25,
  //   "cursor": "bar",                  // block | bar | underline
  //   "padding": 16,
  //   "backgroundImage": "C:/Users/me/Pictures/wall.jpg",
  //   "colors": { "background": "#11131a", "foreground": "#e6e6ea", "accent": "#8ab4ff", "red": "#ff6b7f" }
  // },

  // "shell": {
  //   "default": "prism",               // prism | pwsh | powershell | cmd | gitbash | wsl
  //   "translate": true,                // rewrite bash/cmd syntax (&&, $VAR, dir /s...) into PowerShell
  //   "linux": true                     // ls -la, rm -rf, grep -rn, touch, which... in PowerShell
  // },

  // "prompt": {
  //   "style": "auto",                  // prism | keep (your own oh-my-posh/starship) | auto
  //   "segments": ["userhost", "path", "git", "venv", "duration", "status", "time"],
  //   "symbol": "❯",
  //   "newline": true,
  //   "colors": { "path": "#8ab4ff", "git": "#c792ea", "symbol": "#7ee0b5", "error": "#ff6b7f" }
  // },

  // "aliases": [
  //   { "name": "ll", "body": "ls -la" },
  //   { "name": "proj", "body": "cd ~/projects/{1}" },
  //   { "name": "hi", "type": "text", "body": "Hello {1}!" }
  // ],

  // "keys": { "newTab": "Ctrl+Shift+T", "settings": "Ctrl+,", "toggleWindow": "Ctrl+Alt+T" },

  // "windows": {
  //   "defaultTerminal": true,          // console apps open in Prism instead of the old console window
  //   "explorerMenu": true              // "Open in Prism" / "Run in Prism" in Explorer
  // },

  // "admin": {
  //   "ask": true,                      // offer to re-run commands that failed for lack of admin rights
  //   "mode": "inline"                  // inline (same tab) | window (separate console window)
  // },

  // "startup": { "launchAtLogin": false }
}
`;

const STYLE_TEMPLATE = `/* Prism custom CSS. Loaded into every Prism window; reloads when you save.
   Useful selectors:
     body.prism-terminal  .bar  .tab  .tab.on  .tab.admin  #terms  .term  #settings  .palette
   Variables: --fg --bg --ac --solid --mono

   Examples:
   body.prism-terminal .tab.on { background: var(--ac); color: var(--solid); }
   body.prism-terminal .tab.admin { box-shadow: inset 0 -2px 0 #ff6b7f; }
*/
`;

function ensureFiles() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, CONFIG_TEMPLATE);
    if (!fs.existsSync(STYLE_FILE)) fs.writeFileSync(STYLE_FILE, STYLE_TEMPLATE);
  } catch {}
}

class Config {
  constructor(settingsFile) {
    this.settingsFile = settingsFile;
    this.gui = {};
    this.user = {};
    this.error = null;
    this.css = '';
    this.listeners = [];
    this.lastWritten = '';
    this.load();
  }
  load() {
    try { this.gui = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8').replace(/^\uFEFF/, '')) || {}; } catch { this.gui = {}; }
    try { this.user = parseJsonc(fs.readFileSync(CONFIG_FILE, 'utf8')); this.error = null; }
    catch (e) { if (e.code !== 'ENOENT') this.error = `config.jsonc: ${e.message}`; }
    try { this.css = fs.readFileSync(STYLE_FILE, 'utf8'); } catch { this.css = ''; }
    for (const old of ['dock', 'bar']) { delete this.gui[old]; delete this.user[old]; }
    this.value = merge(merge(clone(DEFAULTS), this.gui), this.user);
    if (!Array.isArray(this.value.aliases)) this.value.aliases = [];
    this.overridden = leafPaths(this.user);
    return this.value;
  }
  get() { return this.value; }
  // Saves Settings-screen changes (only the gui layer; config.jsonc is never touched).
  setGui(patch) {
    this.gui = merge(this.gui, patch);
    if (Array.isArray(patch.aliases)) this.gui.aliases = patch.aliases;
    if (patch.prompt && Array.isArray(patch.prompt.segments)) this.gui.prompt.segments = patch.prompt.segments;
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    this.lastWritten = JSON.stringify(this.gui, null, 2);
    fs.writeFileSync(this.settingsFile, this.lastWritten);
    return this.load();
  }
  onChange(f) { this.listeners.push(f); }
  watch() {
    ensureFiles();
    let t = null;
    const fire = () => { clearTimeout(t); t = setTimeout(() => { const before = JSON.stringify(this.value) + this.css; this.load(); if (JSON.stringify(this.value) + this.css !== before || this.error) this.listeners.forEach(f => f(this.value)); }, 150); };
    try { fs.watch(CONFIG_DIR, fire); } catch {}
    fs.watchFile(this.settingsFile, { interval: 1000 }, () => {
      let raw = ''; try { raw = fs.readFileSync(this.settingsFile, 'utf8'); } catch {}
      if (raw && raw !== this.lastWritten) fire();
    });
  }
}

module.exports = { Config, DEFAULTS, PALETTE, CONFIG_DIR, CONFIG_FILE, STYLE_FILE, parseJsonc, merge, ensureFiles };
