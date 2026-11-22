'use strict';
// Windows integration, all per user (HKCU), all undone when switched off or when Prism is uninstalled:
//   - default terminal: console apps started from Explorer, Start, Win+R... open in a Prism tab
//   - Explorer menus: "Open in Prism" on folders, "Run in Prism" on programs and scripts
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PRISM_CLSID = '{682C9CD9-030D-4029-BA37-7DD6F909FDF8}';
// Windows Terminal's console host (OpenConsole) receives the console from Windows and passes it on to Prism
const WT_CONSOLES = [
  { pkg: 'Microsoft.WindowsTerminal', name: 'Windows Terminal', clsid: '{2EACA947-7F5F-4CFA-BA87-8F7FBEEFBE69}' },
  { pkg: 'Microsoft.WindowsTerminalPreview', name: 'Windows Terminal Preview', clsid: '{06EC847C-C0A5-46B8-92CB-7C92F6E35CD5}' },
  { pkg: 'Microsoft.WindowsTerminalCanary', name: 'Windows Terminal Canary', clsid: '{A854D02A-F2FE-44A5-BB24-D03F4CF830D4}' }
];
const STARTUP = 'HKCU\\Console\\%%Startup';
const CLASSES = 'HKCU\\Software\\Classes';
const PRISM_KEY = 'HKCU\\Software\\Prism';
const MENU_KEYS = [
  ['Directory\\shell\\Prism', 'Open in Prism', '--cwd "%V"'],
  ['Directory\\Background\\shell\\Prism', 'Open in Prism', '--cwd "%V"'],
  ['Drive\\shell\\Prism', 'Open in Prism', '--cwd "%V"'],
  ...['.exe', '.bat', '.cmd', '.ps1', '.py'].map(ext => [`SystemFileAssociations\\${ext}\\shell\\PrismRun`, 'Run in Prism', '--run-file "%1"'])
];

function reg(args) {
  const r = spawnSync('reg.exe', args, { encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, out: r.stdout || '', err: (r.stderr || '').trim() };
}
function regGet(key, name) {
  const r = reg(['query', key, ...(name ? ['/v', name] : ['/ve'])]);
  if (!r.ok) return null;
  const m = r.out.split(/\r?\n/).map(l => l.trim()).find(l => /\sREG_\w+\s/.test(l));
  return m ? m.replace(/^.*?\sREG_\w+\s+/, '').trim() : null;
}
const regSet = (key, name, value) => reg(['add', key, ...(name ? ['/v', name] : ['/ve']), '/t', 'REG_SZ', '/d', value, '/f']);
const regDelValue = (key, name) => reg(['delete', key, '/v', name, '/f']);
const regDelKey = key => reg(['delete', key, '/f']);

class Integration {
  // host: { exe, exeArgs, handoffExe, dataDir }
  constructor(host) { this.host = host; this.backupFile = path.join(host.dataDir, 'defterm-backup.json'); this.wtCache = undefined; }
  launch(extra) { return `"${this.host.exe}"${this.host.exeArgs.map(a => ` "${a}"`).join('')} ${extra}`; }

  // Which Windows Terminal console host is installed (null if none)
  wt() {
    if (this.wtCache !== undefined) return this.wtCache;
    const r = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Get-AppxPackage -Name Microsoft.WindowsTerminal* | ForEach-Object Name'], { encoding: 'utf8', windowsHide: true });
    const names = (r.stdout || '').split(/\r?\n/).map(s => s.trim());
    this.wtCache = WT_CONSOLES.find(c => names.includes(c.pkg)) || null;
    return this.wtCache;
  }

  // full: also look up Windows Terminal (takes about a second)
  status(full = true) {
    const term = regGet(STARTUP, 'DelegationTerminal'), wt = full ? this.wt() : undefined;
    return {
      defaultTerminal: { active: (term || '').toUpperCase() === PRISM_CLSID, helper: fs.existsSync(this.host.handoffExe), console: wt === undefined ? undefined : wt && wt.name },
      explorerMenu: { active: regGet(`${CLASSES}\\${MENU_KEYS[0][0]}`, null) !== null }
    };
  }

  setDefaultTerminal(on) {
    const term = (regGet(STARTUP, 'DelegationTerminal') || '').toUpperCase();
    if (on) {
      const wt = this.wt();
      if (!wt) return { ok: false, error: 'Prism needs the console host that comes with Windows Terminal. Install Windows Terminal (it is built into Windows 11), then try again.' };
      if (!fs.existsSync(this.host.handoffExe)) return { ok: false, error: 'prism-handoff.exe is missing. Reinstall Prism.' };
      if (term !== PRISM_CLSID) {
        // remember what was chosen before, to put it back later
        const prev = { console: regGet(STARTUP, 'DelegationConsole'), terminal: regGet(STARTUP, 'DelegationTerminal') };
        try { fs.writeFileSync(this.backupFile, JSON.stringify(prev)); } catch {}
      }
      regSet(`${CLASSES}\\CLSID\\${PRISM_CLSID}`, null, 'Prism terminal');
      regSet(`${CLASSES}\\CLSID\\${PRISM_CLSID}\\LocalServer32`, null, `"${this.host.handoffExe}"`);
      regSet(PRISM_KEY, 'Exe', this.host.exe);
      regSet(PRISM_KEY, 'Args', this.host.exeArgs.map(a => `"${a}"`).join(' '));
      const a = regSet(STARTUP, 'DelegationConsole', wt.clsid), b = regSet(STARTUP, 'DelegationTerminal', PRISM_CLSID);
      return a.ok && b.ok ? { ok: true } : { ok: false, error: a.err || b.err };
    }
    if (term === PRISM_CLSID) {
      let prev = null; try { prev = JSON.parse(fs.readFileSync(this.backupFile, 'utf8')); } catch {}
      for (const [k, v] of [['DelegationConsole', prev && prev.console], ['DelegationTerminal', prev && prev.terminal]]) {
        if (v && v.toUpperCase() !== PRISM_CLSID) regSet(STARTUP, k, v); else regDelValue(STARTUP, k); // nothing saved: "Let Windows decide"
      }
    }
    try { fs.unlinkSync(this.backupFile); } catch {}
    regDelKey(`${CLASSES}\\CLSID\\${PRISM_CLSID}`);
    return { ok: true };
  }

  setExplorerMenu(on) {
    for (const [key, label, args] of MENU_KEYS) {
      const k = `${CLASSES}\\${key}`;
      if (on) { regSet(k, null, label); regSet(k, 'Icon', this.host.exe); regSet(`${k}\\command`, null, this.launch(args)); }
      else regDelKey(k);
    }
    return { ok: true };
  }

  // Bring the registry in line with the settings (also fixes paths after Prism moved or was updated)
  apply(cfg) {
    const s = this.status(false), want = cfg.windows || {}, out = {};
    if (want.defaultTerminal || s.defaultTerminal.active) out.defaultTerminal = this.setDefaultTerminal(!!want.defaultTerminal);
    if (want.explorerMenu || s.explorerMenu.active) out.explorerMenu = this.setExplorerMenu(!!want.explorerMenu);
    return out;
  }
}

// How to run a file picked in Explorer ("Run in Prism")
function runSpecForFile(file, profiles) {
  const ext = path.extname(file).toLowerCase(), cwd = path.dirname(file), title = path.basename(file);
  const ps = (profiles.find(p => p.kind === 'pwsh' && /pwsh/i.test(p.cmd)) || profiles.find(p => p.kind === 'pwsh') || { cmd: 'powershell.exe' }).cmd;
  if (ext === '.exe' || ext === '.com') return { file, args: [], cwd, title };
  if (ext === '.ps1') return { file: ps, args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], cwd, title };
  if (ext === '.py') return { file: 'py.exe', fallback: 'python.exe', args: [file], cwd, title };
  return { file: 'cmd.exe', args: `/d /s /c ""${file}""`, cwd, title };
}

module.exports = { Integration, runSpecForFile, PRISM_CLSID };
