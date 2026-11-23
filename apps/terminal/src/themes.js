'use strict';
// Your own color themes (~/.config/prism/themes/*.json) and the theme store: a list of themes kept in the
// Prism repository (store/index.json + store/themes/<id>.json), installed with one click from Settings.
const fs = require('fs');
const path = require('path');

const KEYS = ['background', 'foreground', 'cursor', 'selection', 'accent', 'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

// a theme file: { "name": "...", "author": "...", "colors": { "background": "#...", ... } } (or the colors at the top level)
function validTheme(t) {
  if (!t || typeof t !== 'object') return null;
  const c = t.colors && typeof t.colors === 'object' ? t.colors : t;
  const out = { name: String(t.name || '').slice(0, 40) || 'Theme', author: String(t.author || '').slice(0, 60) };
  for (const k of KEYS) if (HEX.test(c[k] || '')) out[k] = c[k].toLowerCase();
  if (!out.background || !out.foreground) return null;
  out.accent = out.accent || out.blue || out.foreground;
  return out;
}

class Themes {
  // host: { dir, fetch, repo() }
  constructor(host) { this.host = host; this.user = {}; }
  load() {
    this.user = {};
    let files = [];
    try { files = fs.readdirSync(this.host.dir).filter(f => f.endsWith('.json')); } catch {}
    for (const f of files) {
      const id = path.basename(f, '.json').toLowerCase();
      if (!ID.test(id)) continue;
      try { const t = validTheme(JSON.parse(fs.readFileSync(path.join(this.host.dir, f), 'utf8'))); if (t) this.user[id] = { ...t, own: true }; } catch {}
    }
    return this.user;
  }
  watch(onChange) {
    try { fs.mkdirSync(this.host.dir, { recursive: true }); } catch {}
    let t; try { fs.watch(this.host.dir, () => { clearTimeout(t); t = setTimeout(() => { this.load(); onChange(); }, 300); }); } catch {}
  }
  base() { return `https://raw.githubusercontent.com/${this.host.repo()}/main/store`; }
  // raw.githubusercontent.com can lag a few minutes behind a push; the GitHub API answers at once
  async get(file) {
    let r = await this.host.fetch(`${this.base()}/${file}`, { headers: { 'User-Agent': 'Prism' } });
    if (!r.ok) {
      const api = await this.host.fetch(`https://api.github.com/repos/${this.host.repo()}/contents/store/${file}?ref=main`, { headers: { 'User-Agent': 'Prism', Accept: 'application/vnd.github.raw' } }).catch(() => null);
      if (api && api.ok) r = api;
    }
    return r;
  }
  async store() {
    const r = await this.get('index.json');
    if (!r.ok) throw new Error(`The theme store answered ${r.status}.`);
    const idx = await r.json();
    return (Array.isArray(idx.themes) ? idx.themes : []).filter(t => t && ID.test(t.id || '')).map(t => ({
      id: t.id, name: String(t.name || t.id).slice(0, 40), author: String(t.author || '').slice(0, 60), description: String(t.description || '').slice(0, 200),
      preview: validTheme(t.preview || {}) || null, installed: !!this.user[t.id]
    }));
  }
  async install(id) {
    if (!ID.test(id || '')) throw new Error('Unknown theme.');
    const r = await this.get(`themes/${id}.json`);
    if (!r.ok) throw new Error(`Could not download the theme (${r.status}).`);
    const t = validTheme(await r.json());
    if (!t) throw new Error('That theme file is not valid.');
    this.save(id, t);
    return id;
  }
  save(id, theme) {
    const t = validTheme(theme);
    if (!ID.test(id || '') || !t) throw new Error('Not a valid theme.');
    fs.mkdirSync(this.host.dir, { recursive: true });
    const { name, author, ...colors } = t;
    fs.writeFileSync(path.join(this.host.dir, `${id}.json`), JSON.stringify({ name, author, colors }, null, 2) + '\n');
    this.load();
  }
  remove(id) {
    if (!ID.test(id || '')) return;
    try { fs.unlinkSync(path.join(this.host.dir, `${id}.json`)); } catch {}
    this.load();
  }
}

module.exports = { Themes, validTheme, KEYS };
