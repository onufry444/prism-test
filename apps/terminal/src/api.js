'use strict';
// The Prism API: programs running in a Prism pane talk to Prism over a named pipe and can show
// images, charts, buttons, forms, notifications and progress. Libraries: sdk/node and sdk/python.
//
//   pipe:     \\.\pipe\prism-api-<user>     (PRISM_API in the environment of every pane)
//   request:  {"id": 1, "tab": "<PRISM_TAB>", "op": "image", ...}\n
//   reply:    {"id": 1, "ok": true, ...}\n      or {"id": 1, "ok": false, "error": "..."}\n
//
// Everything is display only: no request can type into a shell or run anything.
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');

const VERSION = 1;
const OPS = ['hello', 'image', 'chart', 'choose', 'form', 'notify', 'progress', 'title'];
const pipeName = () => `\\\\.\\pipe\\prism-api-${(os.userInfo().username || 'user').replace(/[^A-Za-z0-9_-]/g, '_')}`;
const MAX = 24 * 1024 * 1024; // the largest request (a big image)
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon' };

// What the image bytes are, from their first bytes (the file name may lie)
function sniff(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (/^\s*(<\?xml|<svg)/i.test(b.slice(0, 200).toString())) return 'image/svg+xml';
  return null;
}

class PrismApi {
  // host: { pane(tab) -> { request(op, payload) -> Promise<result> } | null, notify(title, body), progress(tab, value, state) }
  constructor(host) { this.host = host; }
  start(name = pipeName()) {
    this.server = net.createServer(sock => this.client(sock));
    this.server.on('error', e => console.error('Prism API pipe:', e.message));
    this.server.listen(name);
    return this;
  }
  client(sock) {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('data', d => {
      buf += d;
      if (buf.length > MAX) { sock.destroy(); return; }
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let req; try { req = JSON.parse(line); } catch { continue; }
        this.handle(req).then(r => { if (!sock.destroyed) sock.write(JSON.stringify({ id: req.id, ok: true, ...r }) + '\n'); },
          e => { if (!sock.destroyed) sock.write(JSON.stringify({ id: req.id, ok: false, error: String(e && e.message || e) }) + '\n'); });
      }
    });
  }
  async handle(req) {
    const op = String(req.op || '');
    if (!OPS.includes(op)) throw new Error(`unknown request "${op}"`);
    if (op === 'hello') return { version: VERSION, ops: OPS, app: 'Prism' };
    if (op === 'notify') { this.host.notify(String(req.title || 'Prism').slice(0, 200), String(req.body || '').slice(0, 1000)); return {}; }
    const pane = this.host.pane(String(req.tab || ''));
    if (!pane) throw new Error('this program does not run in a Prism pane (PRISM_TAB is missing or the pane is closed)');
    if (op === 'progress') { const v = req.value === null || req.value === undefined ? null : Math.max(0, Math.min(100, Number(req.value) || 0)); this.host.progress(req.tab, v, ['error', 'paused'].includes(req.state) ? req.state : 'normal'); return {}; }
    if (op === 'title') return pane.request('title', { text: String(req.text || '').slice(0, 120) });
    if (op === 'image') return pane.request('image', this.image(req));
    if (op === 'chart') return pane.request('chart', this.chart(req));
    if (op === 'choose') {
      const options = (Array.isArray(req.options) ? req.options : []).map(String).filter(Boolean).slice(0, 12);
      if (!options.length) throw new Error('choose needs options');
      return pane.request('choose', { options: options.map(o => o.slice(0, 60)), prompt: String(req.prompt || '').slice(0, 200) });
    }
    if (op === 'form') return pane.request('form', this.form(req));
  }
  image(req) {
    let data;
    if (req.path) {
      const p = path.resolve(String(req.cwd || os.homedir()), String(req.path));
      data = fs.readFileSync(p);
    } else data = Buffer.from(String(req.data || ''), 'base64');
    if (!data.length) throw new Error('the image is empty');
    if (data.length > 20 * 1024 * 1024) throw new Error('the image is larger than 20 MB');
    const type = sniff(data) || IMAGE_TYPES[String(req.type || path.extname(String(req.path || '')).slice(1)).toLowerCase()];
    if (!type) throw new Error('not an image Prism can show (png, jpg, gif, webp, bmp, svg)');
    return { src: `data:${type};base64,${data.toString('base64')}`, width: clampInt(req.width, 1, 400), height: clampInt(req.height, 1, 200), name: String(req.name || path.basename(String(req.path || 'image'))).slice(0, 80) };
  }
  chart(req) {
    const type = ['line', 'bar'].includes(req.type) ? req.type : 'line';
    const series = (Array.isArray(req.series) ? req.series : []).slice(0, 8).map((s, i) => ({ name: String(s && s.name || `series ${i + 1}`).slice(0, 40), values: (Array.isArray(s && s.values) ? s.values : []).slice(0, 2000).map(Number).map(v => (Number.isFinite(v) ? v : null)) }));
    if (!series.length || !series.some(s => s.values.length)) throw new Error('chart needs series with values');
    const labels = (Array.isArray(req.labels) ? req.labels : []).slice(0, 2000).map(String);
    return { type, title: String(req.title || '').slice(0, 120), labels, series, height: clampInt(req.height, 4, 60) || 12 };
  }
  form(req) {
    const types = ['text', 'password', 'number', 'select', 'checkbox'];
    const fields = (Array.isArray(req.fields) ? req.fields : []).slice(0, 20).map((f, i) => ({
      name: String(f && f.name || `field${i + 1}`).slice(0, 40), label: String(f && (f.label || f.name) || '').slice(0, 80),
      type: types.includes(f && f.type) ? f.type : 'text', value: f && f.value !== undefined ? f.value : '',
      options: Array.isArray(f && f.options) ? f.options.slice(0, 50).map(String) : []
    }));
    if (!fields.length) throw new Error('form needs fields');
    return { title: String(req.title || 'Prism').slice(0, 120), fields, submit: String(req.submit || 'OK').slice(0, 30) };
  }
}
const clampInt = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : null; };

module.exports = { PrismApi, pipeName, sniff, VERSION };
