'use strict';
// Updates from inside Prism (Settings > About): checks GitHub for a newer release, downloads and unpacks it
// next to the running version, then quits and lets a small script swap the folders and start the new Prism.
// If the swap fails, the old version stays (or is put back) and Prism starts again as it was.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const newer = (a, b) => { // is version a newer than b?
  const pa = String(a).split(/[.-]/).map(n => parseInt(n, 10) || 0), pb = String(b).split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};
const psq = s => "'" + String(s).replace(/'/g, "''") + "'";

class Updater {
  // host: { version, fetch, exe, dataDir, quit(), emit(state) }
  constructor(host) {
    this.host = host;
    this.root = path.join(process.env.LOCALAPPDATA || os.homedir(), 'Prism');
    this.appDir = path.join(this.root, 'app');
    this.state = { status: 'idle', current: host.version };
  }
  // Only an installed Prism (in %LOCALAPPDATA%\Prism\app) can update itself
  canInstall() { return process.platform === 'win32' && path.dirname(this.host.exe).toLowerCase() === this.appDir.toLowerCase(); }
  repo() {
    try { const r = fs.readFileSync(path.join(this.root, 'repo.txt'), 'utf8').trim(); if (/^[\w.-]+\/[\w.-]+$/.test(r)) return r; } catch {}
    return process.env.PRISM_TEST_REPO || 'onufry444/prism';
  }
  set(s) { this.state = { ...this.state, ...s }; this.host.emit(this.state); return this.state; }

  async check() {
    if (['downloading', 'preparing', 'restarting'].includes(this.state.status)) return this.state;
    this.set({ status: 'checking', error: null });
    try {
      const r = await this.host.fetch(`https://api.github.com/repos/${this.repo()}/releases/latest`, { headers: { 'User-Agent': 'Prism', Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error(r.status === 404 ? 'No release has been published yet.' : `GitHub answered ${r.status}.`);
      const rel = await r.json();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      const asset = (rel.assets || []).find(a => a.name === 'Prism-win-x64.zip');
      return this.set({ status: newer(latest, this.host.version) ? 'available' : 'latest', latest, notes: String(rel.body || '').slice(0, 4000), url: rel.html_url, asset: asset && { url: asset.browser_download_url, size: asset.size }, checked: Date.now() });
    } catch (e) {
      return this.set({ status: 'error', error: `Could not check for updates: ${e.message}` });
    }
  }

  async install() {
    if (this.state.status !== 'available' || !this.state.asset) return this.state;
    if (!this.canInstall()) return this.set({ status: 'error', error: 'This copy of Prism was not installed with the installer. Run: prism update' });
    const work = path.join(os.tmpdir(), `prism-update-${Date.now()}`);
    fs.mkdirSync(work, { recursive: true });
    const zip = path.join(work, 'prism.zip');
    try {
      // 1. download, with progress
      this.set({ status: 'downloading', progress: 0, error: null });
      const r = await this.host.fetch(this.state.asset.url, { headers: { 'User-Agent': 'Prism' } });
      if (!r.ok || !r.body) throw new Error(`download failed (${r.status})`);
      const total = Number(r.headers.get('content-length')) || this.state.asset.size || 0;
      const out = fs.createWriteStream(zip);
      let got = 0, lastPct = -1;
      for await (const chunk of r.body) {
        got += chunk.length;
        if (!out.write(chunk)) await new Promise(res => out.once('drain', res));
        const pct = total ? Math.floor(got / total * 100) : 0;
        if (pct !== lastPct) { lastPct = pct; this.set({ progress: pct }); }
      }
      await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())));
      if (total && got < total) throw new Error('the download is incomplete');
      // 2. unpack next to the running version (Prism keeps working meanwhile)
      this.set({ status: 'preparing', progress: 100 });
      const newDir = path.join(this.root, 'app.new');
      await this.ps(`$ErrorActionPreference = 'Stop'
        $root = ${psq(this.root)}; $new = ${psq(newDir)}; $x = ${psq(path.join(work, 'x'))}
        Get-ChildItem -LiteralPath $root -Directory -Filter 'app.*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive -LiteralPath ${psq(zip)} -DestinationPath $x -Force
        $exe = Get-ChildItem -LiteralPath $x -Filter 'Prism.exe' -Recurse | Select-Object -First 1
        if (-not $exe) { throw 'The download does not contain Prism.exe.' }
        Move-Item -LiteralPath $exe.DirectoryName -Destination $new`);
      // 3. quit; the swap script waits for every Prism process to end, swaps the folders and starts the new version
      const script = path.join(work, 'swap.ps1');
      fs.writeFileSync(script, '﻿' + SWAP);
      this.set({ status: 'restarting' });
      const p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Root', this.root, '-Work', work, '-Version', this.state.latest], { detached: true, stdio: 'ignore', windowsHide: true });
      p.unref();
      setTimeout(() => this.host.quit(), 300);
    } catch (e) {
      try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
      this.set({ status: 'available', error: `The update did not work: ${e.message}` });
    }
    return this.state;
  }

  ps(script) {
    return new Promise((resolve, reject) => {
      const p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true });
      let err = '';
      p.stderr.on('data', d => { err += d; });
      p.on('error', reject);
      p.on('close', code => (code === 0 ? resolve() : reject(new Error(err.split(/\r?\n/).find(l => l.trim()) || `PowerShell exited with ${code}`))));
      p.stdin.end(script);
    });
  }

  // after a restart: did the last update work?
  lastResult() {
    const f = path.join(this.root, 'update-result.json');
    try { const r = JSON.parse(fs.readFileSync(f, 'utf8')); fs.unlinkSync(f); return r; } catch { return null; }
  }
}

// Runs hidden after Prism quits.
const SWAP = `param([string]$Root, [string]$Work, [string]$Version)
$app = Join-Path $Root 'app'; $new = Join-Path $Root 'app.new'; $old = Join-Path $Root ('app.old-' + [DateTime]::Now.Ticks)
$log = Join-Path $Root 'update.log'
function Log([string]$m) { Add-Content -LiteralPath $log -Value ("{0:s} {1}" -f (Get-Date), $m) }
function Result($ok, $msg) { [IO.File]::WriteAllText((Join-Path $Root 'update-result.json'), (@{ ok = $ok; version = $Version; message = $msg } | ConvertTo-Json -Compress)) }
$inApp = { param($p) $p -and $p.StartsWith($app + '\\', [StringComparison]::OrdinalIgnoreCase) }
Log "update to $Version"
$moved = $false
for ($i = 0; $i -lt 80; $i++) {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object { & $inApp $_.Path }) | Stop-Process -Force -ErrorAction SilentlyContinue
  try { Rename-Item -LiteralPath $app -NewName (Split-Path $old -Leaf) -ErrorAction Stop; $moved = $true; break } catch { Start-Sleep -Milliseconds 500 }
}
if ($moved) {
  try { Rename-Item -LiteralPath $new -NewName 'app' -ErrorAction Stop; Result $true "Updated to Prism $Version."; Log 'done' }
  catch { Rename-Item -LiteralPath $old -NewName 'app' -ErrorAction SilentlyContinue; Result $false "Could not install the new version: $($_.Exception.Message)"; Log "failed: $_" }
} else {
  Result $false 'Something kept the Prism folder busy, so Prism stayed on the current version. Try again, or run: prism update'
  Log 'folder busy'
}
Start-Process -FilePath (Join-Path $app 'Prism.exe')
Start-Sleep -Seconds 3
if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path -LiteralPath $new) { Remove-Item -LiteralPath $new -Recurse -Force -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
`;

module.exports = { Updater, newer, SWAP };
