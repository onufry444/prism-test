'use strict';
// Terminal toys, like on Linux: fetch, lava, matrix, pipes, donut, clock, visualizer.
// They run inside Prism and draw straight into the tab that asked (no extra programs needed), on the
// alternate screen, so the shell's screen comes back untouched. fetch prints its text through the shell.
// q, Esc or Ctrl+C quits.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ESC = '\x1b';
const rgb = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
const R = c => (c >> 16) & 255, G = c => (c >> 8) & 255, B = c => c & 255;
const mix = (a, b, t) => rgb(R(a) + (R(b) - R(a)) * t, G(a) + (G(b) - G(a)) * t, B(a) + (B(b) - B(a)) * t);
const ramp = (stops, t) => { t = Math.max(0, Math.min(1, t)) * (stops.length - 1); const i = Math.min(stops.length - 2, Math.floor(t)); return mix(stops[i], stops[i + 1], t - i); };
const fg = c => `${ESC}[38;2;${R(c)};${G(c)};${B(c)}m`;
const hex = s => parseInt(s.replace('#', ''), 16);

// ------------------------------------------------------------------ a cell screen that only sends what changed
class Screen {
  constructor(cols, rows) { this.resize(cols, rows); }
  resize(cols, rows) {
    this.cols = Math.max(10, cols); this.rows = Math.max(4, rows);
    const n = this.cols * this.rows;
    this.ch = new Array(n).fill(' '); this.fg = new Int32Array(n).fill(-1); this.bg = new Int32Array(n).fill(-1);
    this.pch = null; // forces a full redraw
  }
  clear(bg = -1) { this.ch.fill(' '); this.fg.fill(-1); this.bg.fill(bg); }
  set(x, y, ch, f = -1, b) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x; this.ch[i] = ch; this.fg[i] = f; if (b !== undefined) this.bg[i] = b;
  }
  text(x, y, s, f = -1, b) { for (const c of s) this.set(x++, y, c, f, b); }
  flush() {
    const full = !this.pch;
    if (full) { this.pch = new Array(this.ch.length).fill(null); this.pfg = new Int32Array(this.ch.length); this.pbg = new Int32Array(this.ch.length); }
    let out = full ? `${ESC}[0m${ESC}[2J` : '', cx = -1, cy = -1, cf = -2, cb = -2;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x, ch = this.ch[i], f = this.fg[i], b = this.bg[i];
        if (!full && this.pch[i] === ch && this.pfg[i] === f && this.pbg[i] === b) continue;
        this.pch[i] = ch; this.pfg[i] = f; this.pbg[i] = b;
        if (cx !== x || cy !== y) out += `${ESC}[${y + 1};${x + 1}H`;
        if (f !== cf) { out += f < 0 ? `${ESC}[39m` : `${ESC}[38;2;${R(f)};${G(f)};${B(f)}m`; cf = f; }
        if (b !== cb) { out += b < 0 ? `${ESC}[49m` : `${ESC}[48;2;${R(b)};${G(b)};${B(b)}m`; cb = b; }
        out += ch; cx = x + 1; cy = y;
      }
    }
    return out;
  }
}

// ------------------------------------------------------------------ animations
// Each: { fps, init(scr, args), frame(scr, t, dt), key?(k) }
const ANIMS = {};

ANIMS.lava = {
  fps: 24,
  themes: {
    lava: [hex('#12051f'), hex('#3b0d4f'), hex('#b0306e'), hex('#ff6b3d'), hex('#ffd36b')],
    ocean: [hex('#020b1a'), hex('#06325c'), hex('#1478a8'), hex('#3fd1c7'), hex('#c8fff4')],
    forest: [hex('#03120a'), hex('#0b3d22'), hex('#2f8f46'), hex('#a6d854'), hex('#f4ffb0')],
    sunset: [hex('#140616'), hex('#4a1336'), hex('#d1495b'), hex('#f9a03f'), hex('#fff1a8')],
    mono: [hex('#0a0a0a'), hex('#2a2a2a'), hex('#777777'), hex('#cfcfcf'), hex('#ffffff')]
  },
  init(scr, args) {
    const names = Object.keys(this.themes);
    this.theme = names.find(n => args.includes(n) || args.includes('--' + n)) || 'lava';
    this.blobs = Array.from({ length: 7 }, (_, i) => ({ x: Math.random(), y: Math.random(), r: 0.07 + Math.random() * 0.07, sx: 0.03 + Math.random() * 0.05, sy: 0.05 + Math.random() * 0.08, p: Math.random() * 6.3, i }));
  },
  key(k) { if (k === 't' || k === ' ') { const n = Object.keys(this.themes); this.theme = n[(n.indexOf(this.theme) + 1) % n.length]; } },
  frame(scr, t) {
    const pal = this.themes[this.theme], W = scr.cols, H = scr.rows * 2, aspect = W / H; // half blocks make square pixels
    const bl = this.blobs.map(b => ({
      x: (0.5 + 0.44 * Math.sin(t * b.sx * 2 + b.p)) * aspect,
      y: 0.5 + 0.45 * Math.sin(t * b.sy * 2 + b.p * 1.7),
      r2: (b.r * (1 + 0.25 * Math.sin(t * 0.7 + b.i))) ** 2
    }));
    const field = (px, py) => { const x = px / H, y = py / H; let f = 0; for (const b of bl) { const dx = x - b.x, dy = y - b.y; f += b.r2 / (dx * dx + dy * dy + 1e-4); } return f; };
    const color = (f, py) => {
      if (f < 1) return mix(pal[0], pal[1], Math.min(1, f * f * 0.9) * (0.6 + 0.4 * py / H));
      return ramp(pal.slice(2), Math.min(1, (f - 1) / 2.2));
    };
    const q = c => c & 0xF8F8F8; // fewer distinct colors = less to send
    for (let y = 0; y < scr.rows; y++) for (let x = 0; x < W; x++) {
      const a = color(field(x, y * 2), y * 2), b = color(field(x, y * 2 + 1), y * 2 + 1);
      scr.set(x, y, '▀', q(a), q(b));
    }
    scr.text(1, scr.rows - 1, ` ${this.theme} · t theme · q quit `, hex('#cccccc'), q(color(0, H)));
  }
};

ANIMS.matrix = {
  fps: 20,
  init(scr) { this.drops = []; this.reset(scr); },
  reset(scr) { scr.clear(); this.drops = Array.from({ length: scr.cols }, () => ({ y: -Math.random() * scr.rows * 2, v: 0.4 + Math.random() * 0.9, len: 6 + (Math.random() * scr.rows * 0.7) | 0 })); this.w = scr.cols; },
  glyph() { const r = Math.random(); return r < 0.75 ? String.fromCharCode(0xFF66 + ((Math.random() * 56) | 0)) : r < 0.9 ? String((Math.random() * 10) | 0) : ':.="*+-<>|'[(Math.random() * 10) | 0]; },
  frame(scr) {
    if (this.w !== scr.cols) this.reset(scr);
    for (let x = 0; x < scr.cols; x++) {
      const d = this.drops[x], prev = Math.floor(d.y);
      d.y += d.v;
      const head = Math.floor(d.y);
      for (let y = prev; y <= head; y++) if (y >= 0 && y < scr.rows) scr.set(x, y, this.glyph(), hex('#e8ffe8'));
      for (let k = 1; k <= d.len; k++) {
        const y = head - k; if (y < 0 || y >= scr.rows) continue;
        const i = y * scr.cols + x;
        if (scr.ch[i] === ' ') continue;
        const t = k / d.len;
        scr.fg[i] = t >= 1 ? -1 : mix(hex('#5dff7a'), hex('#062b10'), t);
        if (Math.random() < 0.02) scr.ch[i] = this.glyph();
      }
      const tail = head - d.len - 1;
      if (tail >= 0 && tail < scr.rows) scr.set(x, tail, ' ');
      if (tail > scr.rows) { d.y = -Math.random() * 10; d.v = 0.4 + Math.random() * 0.9; d.len = 6 + (Math.random() * scr.rows * 0.7) | 0; }
    }
  }
};

ANIMS.pipes = {
  fps: 30,
  colors: ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff', '#ff9f1c', '#2ec4b6', '#f72585'].map(hex),
  init(scr) { this.start(scr); },
  start(scr) {
    scr.clear(); this.count = 0; this.w = scr.cols; this.h = scr.rows;
    this.pipes = Array.from({ length: 5 }, () => ({ x: (Math.random() * scr.cols) | 0, y: (Math.random() * scr.rows) | 0, d: (Math.random() * 4) | 0, c: this.colors[(Math.random() * this.colors.length) | 0] }));
  },
  frame(scr) {
    if (this.w !== scr.cols || this.h !== scr.rows || this.count > scr.cols * scr.rows * 0.9) this.start(scr);
    const corner = { '01': '┏', '03': '┓', '21': '┗', '23': '┛', '10': '┛', '12': '┓', '30': '┗', '32': '┏' };
    for (let s = 0; s < 3; s++) for (const p of this.pipes) {
      let nd = p.d;
      if (Math.random() < 0.12) nd = (p.d + (Math.random() < 0.5 ? 1 : 3)) % 4;
      scr.set(p.x, p.y, nd === p.d ? (p.d % 2 ? '━' : '┃') : corner[`${p.d}${nd}`], p.c);
      p.d = nd;
      p.x += [0, 1, 0, -1][p.d]; p.y += [-1, 0, 1, 0][p.d];
      if (p.x < 0 || p.x >= scr.cols || p.y < 0 || p.y >= scr.rows) {
        // leave the screen, come back elsewhere in a new color
        p.x = (p.x + scr.cols) % scr.cols; p.y = (p.y + scr.rows) % scr.rows;
        p.c = this.colors[(Math.random() * this.colors.length) | 0];
      }
      this.count++;
    }
  }
};

ANIMS.donut = {
  fps: 30,
  init() { this.A = 0; this.B = 0; },
  frame(scr) {
    scr.clear();
    const W = scr.cols, H = scr.rows, z = new Float32Array(W * H), lum = '.,-~:;=!*#$@';
    const K2 = 5, K1 = Math.min(W, H * 2) * K2 * 3 / (8 * 3);
    const cA = Math.cos(this.A), sA = Math.sin(this.A), cB = Math.cos(this.B), sB = Math.sin(this.B);
    for (let th = 0; th < 6.28; th += 0.06) {
      const ct = Math.cos(th), st = Math.sin(th);
      for (let ph = 0; ph < 6.28; ph += 0.02) {
        const cp = Math.cos(ph), sp = Math.sin(ph), cx = 2 + ct, cy = st;
        const x = cx * (cB * cp + sA * sB * sp) - cy * cA * sB;
        const y = cx * (sB * cp - sA * cB * sp) + cy * cA * cB;
        const ooz = 1 / (K2 + cA * cx * sp + cy * sA);
        const xp = (W / 2 + K1 * ooz * x) | 0, yp = (H / 2 - K1 * ooz * y / 2) | 0;
        const L = cp * ct * sB - cA * ct * sp - sA * st + cB * (cA * st - ct * sA * sp);
        if (L > 0 && xp >= 0 && xp < W && yp >= 0 && yp < H && ooz > z[yp * W + xp]) {
          z[yp * W + xp] = ooz;
          const l = Math.min(11, (L * 8) | 0);
          scr.set(xp, yp, lum[l], ramp([hex('#4d2c91'), hex('#c45bd8'), hex('#ff9fb2'), hex('#fff3c4')], l / 11));
        }
      }
    }
    this.A += 0.07; this.B += 0.03;
  }
};

const BIG = { // 5 rows, 4 wide
  0: ['████', '█  █', '█  █', '█  █', '████'], 1: ['  ██', '   █', '   █', '   █', '   █'], 2: ['████', '   █', '████', '█   ', '████'],
  3: ['████', '   █', ' ███', '   █', '████'], 4: ['█  █', '█  █', '████', '   █', '   █'], 5: ['████', '█   ', '████', '   █', '████'],
  6: ['████', '█   ', '████', '█  █', '████'], 7: ['████', '   █', '   █', '   █', '   █'], 8: ['████', '█  █', '████', '█  █', '████'],
  9: ['████', '█  █', '████', '   █', '████'], ':': ['    ', ' ██ ', '    ', ' ██ ', '    ']
};
ANIMS.clock = {
  fps: 4,
  init() {},
  frame(scr, t) {
    const d = new Date(), s = d.toLocaleTimeString('en-GB', { hour12: false });
    scr.clear();
    const w = s.length * 5 * 2, x0 = Math.max(0, ((scr.cols - w) / 2) | 0), y0 = Math.max(0, ((scr.rows - 7) / 2) | 0);
    [...s].forEach((ch, i) => (BIG[ch] || BIG[':']).forEach((line, r) => [...line].forEach((c, k) => {
      if (c === ' ') return;
      const col = ramp([hex('#7aa2f7'), hex('#bb9af7'), hex('#f7768e')], (i * 5 + k) / (s.length * 5));
      scr.set(x0 + (i * 5 + k) * 2, y0 + r, '█', col); scr.set(x0 + (i * 5 + k) * 2 + 1, y0 + r, '█', col);
    })));
    const date = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    scr.text(((scr.cols - date.length) / 2) | 0, y0 + 6, date, hex('#a9b1d6'));
  }
};

ANIMS.visualizer = {
  fps: 30,
  init(scr, args, ctx) {
    this.bands = null; this.smooth = []; this.peaks = []; this.error = null; this.since = Date.now();
    this.stop = ctx.audio ? ctx.audio(b => { this.bands = b; this.last = Date.now(); }, e => { this.error = e; }) : null;
    if (!this.stop) this.error = 'Audio capture is not available here.';
  },
  dispose() { try { this.stop && this.stop(); } catch {} },
  frame(scr) {
    scr.clear();
    const n = Math.max(4, Math.floor(scr.cols / 3)), H = scr.rows - 1, now = Date.now();
    const quiet = !this.bands || now - (this.last || 0) > 1500;
    for (let i = 0; i < n; i++) {
      let v = 0;
      if (this.bands && !quiet) { const p = i / (n - 1) * (this.bands.length - 1), a = Math.floor(p); v = this.bands[a] + (this.bands[Math.min(a + 1, this.bands.length - 1)] - this.bands[a]) * (p - a); }
      this.smooth[i] = Math.max(v, (this.smooth[i] || 0) * 0.82);
      this.peaks[i] = Math.max(this.smooth[i], (this.peaks[i] || 0) - 0.012);
      const h = this.smooth[i] * H, full = Math.floor(h), part = Math.floor((h - full) * 8);
      for (let y = 0; y < H; y++) {
        const row = H - 1 - y, col = ramp([hex('#2ec4b6'), hex('#4d96ff'), hex('#c77dff'), hex('#f72585')], y / H);
        const ch = y < full ? '█' : y === full && part ? ' ▁▂▃▄▅▆▇'[part] : null;
        if (ch) { scr.set(i * 3, row, ch, col); scr.set(i * 3 + 1, row, ch, col); }
      }
      const py = H - 1 - Math.floor(this.peaks[i] * H);
      if (this.peaks[i] > 0.02 && py >= 0) { scr.set(i * 3, py, '▔', hex('#ffffff')); scr.set(i * 3 + 1, py, '▔', hex('#ffffff')); }
    }
    const msg = this.error ? `${this.error}` : quiet ? (now - this.since < 2500 ? 'Listening…' : 'Play some music — Prism shows what your PC is playing.') : '';
    if (msg) scr.text(Math.max(0, ((scr.cols - msg.length) / 2) | 0), (scr.rows / 2) | 0, msg, hex('#c0caf5'));
    scr.text(1, scr.rows - 1, ' q quit ', hex('#7f849c'));
  }
};

// ------------------------------------------------------------------ fetch
function reg(key, name) {
  if (process.platform !== 'win32') return '';
  const r = spawnSync('reg.exe', ['query', key, '/v', name], { encoding: 'utf8', windowsHide: true });
  const m = (r.stdout || '').match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`));
  return m ? m[1].trim() : '';
}
const gib = n => (n / 1024 ** 3).toFixed(1) + ' GiB';
const dur = s => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return [d && `${d} day${d > 1 ? 's' : ''}`, h && `${h} hour${h > 1 ? 's' : ''}`, `${m} min${m === 1 ? '' : 's'}`].filter(Boolean).join(', '); };

function fetchInfo(ctx) {
  const info = [];
  const build = Number((os.release().split('.')[2]) || 0);
  let name = process.platform === 'win32' ? (os.version() || 'Windows') : `${os.type()} ${os.release()}`;
  if (build >= 22000) name = name.replace('Windows 10', 'Windows 11');
  const disp = reg('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', 'DisplayVersion');
  info.push(['OS', `${name}${disp ? ' ' + disp : ''} ${os.arch()}`]);
  const host = reg('HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS', 'SystemProductName');
  if (host && !/to be filled|system product name/i.test(host)) info.push(['Host', host]);
  info.push(['Kernel', `${os.type() === 'Windows_NT' ? 'WIN32_NT' : os.type()} ${os.release()}`]);
  info.push(['Uptime', dur(os.uptime())]);
  if (ctx.shell) info.push(['Shell', ctx.shell]);
  if (ctx.display) info.push(['Display', ctx.display]);
  info.push(['Terminal', `Prism ${ctx.version}`]);
  const cpus = os.cpus();
  if (cpus.length) {
    const model = cpus[0].model.replace(/\s+/g, ' ').replace(/\((R|TM)\)/g, '').replace(/ CPU| Processor|\s+\d+-Core/g, '').trim();
    info.push(['CPU', `${model} (${cpus.length})${!/@/.test(model) && cpus[0].speed ? ` @ ${(cpus[0].speed / 1000).toFixed(2)} GHz` : ''}`]);
  }
  const gpus = [];
  for (let i = 0; i < 4; i++) { const g = reg(`HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\000${i}`, 'DriverDesc'); if (g && !gpus.includes(g) && !/basic display|remote/i.test(g)) gpus.push(g); }
  gpus.forEach(g => info.push(['GPU', g]));
  const used = os.totalmem() - os.freemem();
  info.push(['Memory', `${gib(used)} / ${gib(os.totalmem())} (${Math.round(used / os.totalmem() * 100)}%)`]);
  try {
    const root = process.platform === 'win32' ? (process.env.SystemDrive || 'C:') + '\\' : '/';
    const s = fs.statfsSync(root), total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    info.push([`Disk (${root.replace(/\\$/, '')})`, `${gib(total - free)} / ${gib(total)} (${Math.round((total - free) / total * 100)}%)`]);
  } catch {}
  info.push(['Locale', Intl.DateTimeFormat().resolvedOptions().locale]);
  return info;
}

// The Prism logo: white light goes in, a rainbow comes out.
function logo() {
  const H = 9, w = 2 * H + 1, rays = ['#ff5f6d', '#ffa94d', '#ffe66d', '#6ee7a8', '#5ab9ff', '#b38cff'].map(hex);
  const lines = [];
  for (let r = 0; r < H; r++) {
    let s = '';
    const pad = H - r, beamRow = Math.floor(H / 2);
    // incoming white beam
    s += r === beamRow ? fg(hex('#f5f5f5')) + '━'.repeat(pad) : ' '.repeat(pad);
    // the prism, shaded from top to bottom
    const body = ramp([hex('#e0d4ff'), hex('#9b7bff'), hex('#5b3fd6')], r / (H - 1));
    s += fg(body) + (r === 0 ? '▄▄' : '▟' + '█'.repeat(2 * r - 2) + '▙');
    // outgoing rainbow
    const k = r - beamRow + 1;
    if (k >= 0 && k < rays.length) s += fg(rays[k]) + '━'.repeat(6 + k * 2);
    lines.push({ s, w: pad + (r === 0 ? 2 : 2 * r) + (k >= 0 && k < rays.length ? 6 + k * 2 : 0) });
  }
  lines.push({ s: ' ' + fg(hex('#3a2a8a')) + '▀'.repeat(2 * (H - 1)), w: 2 * H - 1 });
  return { lines, width: Math.max(...lines.map(l => l.w), w) };
}

function fetchText(ctx, cols) {
  const user = os.userInfo().username, host = os.hostname();
  const accent = hex('#b38cff'), label = hex('#8ab4ff'), dim = hex('#6c7086');
  const title = `${fg(accent)}${ESC}[1m${user}${ESC}[0m${fg(dim)}@${fg(accent)}${ESC}[1m${host}${ESC}[0m`;
  const right = [title, fg(dim) + '─'.repeat(user.length + host.length + 1)];
  for (const [k, v] of fetchInfo(ctx)) right.push(`${fg(label)}${ESC}[1m${k}${ESC}[0m${fg(dim)}: ${ESC}[0m${v}`);
  right.push('');
  const blocks = [0, 1, 2, 3, 4, 5, 6, 7].map(i => `${ESC}[4${i}m   `).join('') + `${ESC}[0m`;
  const bright = [0, 1, 2, 3, 4, 5, 6, 7].map(i => `${ESC}[10${i}m   `).join('') + `${ESC}[0m`;
  right.push(blocks, bright);
  const L = logo(), showLogo = cols >= L.width + 50;
  const rows = Math.max(right.length, showLogo ? L.lines.length : 0), out = [''];
  for (let i = 0; i < rows; i++) {
    let line = '';
    if (showLogo) { const l = L.lines[i]; line += (l ? l.s + ESC + '[0m' + ' '.repeat(L.width - l.w) : ' '.repeat(L.width)) + '   '; }
    line += right[i] || '';
    out.push(' ' + line + `${ESC}[0m`);
  }
  out.push('');
  return out.join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ sessions
const NAMES = { lava: 'lava', lavalamp: 'lava', matrix: 'matrix', cmatrix: 'matrix', pipes: 'pipes', donut: 'donut', clock: 'clock', 'tty-clock': 'clock', visualizer: 'visualizer', cava: 'visualizer', fetch: 'fetch', fastfetch: 'fetch', neofetch: 'fetch' };
const LIST = [
  ['fetch', 'system info with the Prism logo, like fastfetch'],
  ['lava', 'a lava lamp (t: next colors: lava, ocean, forest, sunset, mono)'],
  ['matrix', 'falling green code'],
  ['pipes', 'pipes growing across the screen'],
  ['donut', 'the spinning ASCII donut'],
  ['clock', 'a big clock'],
  ['visualizer', 'bars that move with whatever your PC is playing (also: cava)']
];

class Toys {
  // host: { resultsDir, tab(id) -> { cols, rows, send(data), profile }, version, display(), audio(onBands, onError) -> stop }
  constructor(host) { this.host = host; this.sessions = new Map(); }
  has(tab) { return this.sessions.has(tab); }
  result(id, r) {
    try { fs.mkdirSync(this.host.resultsDir, { recursive: true }); const f = path.join(this.host.resultsDir, `${id}.json`); fs.writeFileSync(f + '.tmp', JSON.stringify(r)); fs.renameSync(f + '.tmp', f); } catch {}
  }
  start(req) {
    if (!/^[0-9a-f]{32}$/.test(req.id || '')) return;
    const name = NAMES[String(req.name || '').toLowerCase()], tab = this.host.tab(req.tab), args = (Array.isArray(req.args) ? req.args : []).map(String);
    if (!name) return this.result(req.id, { code: 0, text: 'Prism toys:\r\n' + LIST.map(([n, d]) => `  \x1b[1m${n.padEnd(11)}\x1b[0m ${d}`).join('\r\n') + '\r\n' });
    if (!tab) return this.result(req.id, { code: 1, text: 'Prism could not find the tab that asked.\r\n' });
    const ctx = { version: this.host.version, shell: tab.profile && (tab.profile.prism ? `Prism shell (${tab.profile.name})` : tab.profile.name), display: this.host.display && this.host.display(), audio: this.host.audio };
    if (name === 'fetch') return this.result(req.id, { code: 0, text: fetchText(ctx, tab.cols) });
    if (this.sessions.has(req.tab)) return this.result(req.id, { code: 1, text: 'Something is already running in this tab.\r\n' });
    const anim = Object.assign(Object.create(ANIMS[name]), {});
    const scr = new Screen(tab.cols, tab.rows);
    const s = { anim, scr, tab, id: req.id, t0: Date.now(), last: Date.now() };
    try { anim.init(scr, args, ctx); } catch (e) { return this.result(req.id, { code: 1, text: `${name}: ${e.message}\r\n` }); }
    tab.send(`${ESC}[?1049h${ESC}[?25l${ESC}[2J`);
    const tick = () => {
      const now = Date.now();
      try { anim.frame(scr, (now - s.t0) / 1000, (now - s.last) / 1000); } catch (e) { return this.stop(req.tab, `${name}: ${e.message}`); }
      s.last = now;
      const out = scr.flush();
      if (out) tab.send(out);
    };
    s.timer = setInterval(tick, 1000 / anim.fps);
    this.sessions.set(req.tab, s);
    tick();
  }
  input(tab, data) {
    const s = this.sessions.get(tab); if (!s) return false;
    const d = String(data);
    if (/^(q|Q|\x1b|\x03)$/.test(d) || d.includes('\x03')) this.stop(tab);
    else if (s.anim.key) s.anim.key(d);
    return true;
  }
  resize(tab, cols, rows) { const s = this.sessions.get(tab); if (s) { s.scr.resize(cols, rows); } }
  stop(tab, error) {
    const s = this.sessions.get(tab); if (!s) return;
    clearInterval(s.timer);
    try { s.anim.dispose && s.anim.dispose(); } catch {}
    this.sessions.delete(tab);
    s.tab.send(`${ESC}[0m${ESC}[?25h${ESC}[?1049l`);
    this.result(s.id, { code: error ? 1 : 0, text: error ? error + '\r\n' : '' });
  }
}

module.exports = { Toys, NAMES, LIST, fetchText, Screen, ANIMS };
