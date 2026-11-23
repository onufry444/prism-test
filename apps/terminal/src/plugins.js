'use strict';
// Plugins: folders in ~/.config/prism/plugins/<name>/ with a plugin.json and a JavaScript file.
// A plugin can add commands (they print text), animations (drawn like the toys) and color schemes:
//
//   module.exports = {
//     commands:   { hello: async (ctx, args) => `Hello ${args[0] || 'world'}\n` },
//     animations: { fire: { fps: 20, init(screen, args, ctx) {}, frame(screen, seconds) {}, key(k) {} } },
//     schemes:    { 'my-colors': { name: 'My colors', background: '#101014', foreground: '#e0e0e0', ... } }
//   };
//
// Plugins run inside Prism with your user's rights, like any program you install. Only install plugins you trust.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const NAME = /^[a-z][a-z0-9-]{0,39}$/;

class Plugins {
  // host: { dir, disabled() -> [names], builtin: Set of command names that plugins may not take, fetch, onChange() }
  constructor(host) { this.host = host; this.list = []; this.commands = new Map(); this.animations = new Map(); this.schemes = {}; }
  load() {
    for (const p of this.list) if (p.file) delete require.cache[require.resolve(p.file)];
    this.list = []; this.commands.clear(); this.animations.clear(); this.schemes = {};
    let dirs = [];
    try { dirs = fs.readdirSync(this.host.dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch {}
    const off = new Set(this.host.disabled());
    for (const d of dirs.sort()) {
      const root = path.join(this.host.dir, d), info = { dir: root, name: d, enabled: !off.has(d), commands: [], animations: [], schemes: [], error: null };
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
        Object.assign(info, { name: String(meta.name || d), version: String(meta.version || ''), description: String(meta.description || ''), author: String(meta.author || '') });
        if (!info.enabled) { this.list.push(info); continue; }
        info.file = path.join(root, String(meta.main || 'index.js'));
        const mod = require(info.file);
        for (const [k, fn] of Object.entries(mod.commands || {})) {
          if (!NAME.test(k) || typeof fn !== 'function' || this.host.builtin.has(k) || this.commands.has(k)) continue;
          this.commands.set(k, { fn, plugin: info.name }); info.commands.push(k);
        }
        for (const [k, a] of Object.entries(mod.animations || {})) {
          if (!NAME.test(k) || !a || typeof a.frame !== 'function' || this.host.builtin.has(k) || this.commands.has(k) || this.animations.has(k)) continue;
          this.animations.set(k, { anim: a, plugin: info.name }); info.animations.push(k);
        }
        for (const [k, s] of Object.entries(mod.schemes || {})) {
          if (!/^[a-z0-9-]{1,40}$/.test(k) || !s || !/^#[0-9a-f]{6}$/i.test(s.background || '') || !/^#[0-9a-f]{6}$/i.test(s.foreground || '')) continue;
          this.schemes[k] = { ...s, name: String(s.name || k), plugin: info.name }; info.schemes.push(k);
        }
      } catch (e) { info.error = e.message; }
      this.list.push(info);
    }
    return this;
  }
  names() { return [...this.commands.keys(), ...this.animations.keys()]; }
  watch() {
    try { fs.mkdirSync(this.host.dir, { recursive: true }); } catch {}
    let t; try { fs.watch(this.host.dir, { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => { this.load(); this.host.onChange(); }, 400); }); } catch {}
  }

  // install from GitHub: owner/repo (the plugin.json may be at the top or in one folder below it)
  async install(spec) {
    const m = /^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(spec || '').trim());
    if (!m) throw new Error('Give a GitHub repository like owner/name.');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-plugin-'));
    try {
      const r = await this.host.fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/zipball`, { headers: { 'User-Agent': 'Prism' } });
      if (!r.ok) throw new Error(r.status === 404 ? `${m[1]}/${m[2]} was not found on GitHub.` : `GitHub answered ${r.status}.`);
      fs.writeFileSync(path.join(work, 'p.zip'), Buffer.from(await r.arrayBuffer()));
      await unzip(path.join(work, 'p.zip'), path.join(work, 'x'));
      const found = findPlugin(path.join(work, 'x'));
      if (!found) throw new Error('That repository has no plugin.json.');
      const meta = JSON.parse(fs.readFileSync(path.join(found, 'plugin.json'), 'utf8'));
      const name = String(meta.name || m[2]).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
      const dest = path.join(this.host.dir, name);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(this.host.dir, { recursive: true });
      fs.cpSync(found, dest, { recursive: true });
      this.load(); this.host.onChange();
      return this.list.find(p => p.dir === dest) || { name };
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  }
  remove(name) {
    const p = this.list.find(x => x.name === name || path.basename(x.dir) === name);
    if (!p) throw new Error(`No plugin called ${name}.`);
    if (p.file) delete require.cache[require.resolve(p.file)];
    fs.rmSync(p.dir, { recursive: true, force: true });
    this.load(); this.host.onChange();
    return p.name;
  }
}
function findPlugin(dir, depth = 0) {
  if (fs.existsSync(path.join(dir, 'plugin.json'))) return dir;
  if (depth > 2) return null;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) if (d.isDirectory()) { const f = findPlugin(path.join(dir, d.name), depth + 1); if (f) return f; }
  return null;
}
function unzip(zip, dest) {
  return new Promise((resolve, reject) => {
    const ps = `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`;
    const p = process.platform === 'win32' ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }) : spawn('unzip', ['-q', zip, '-d', dest]);
    p.on('error', reject);
    p.on('close', c => (c === 0 ? resolve() : reject(new Error('could not unpack the plugin'))));
  });
}

module.exports = { Plugins };
