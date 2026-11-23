'use strict';
// Prism API for Node.js: show images, charts, buttons and forms in Prism, report progress, send notifications.
// No dependencies. In any other terminal every function still works, with a plain-text fallback.
//
//   const prism = require('./prism');            // or copy this file into your project
//   if (prism.available()) await prism.image('chart.png');
//   const pick = await prism.choose('Deploy?', ['Yes', 'No']);
//   await prism.progress(40);
//
// Docs: https://github.com/onufry444/prism/blob/main/docs/api.md
const net = require('net');
const fs = require('fs');
const readline = require('readline');

let conn = null, buf = '', seq = 0;
const waiting = new Map();

/** True when this program runs in a Prism pane. */
function available() { return !!(process.env.PRISM_API && process.env.PRISM_TAB && process.platform === 'win32'); }

function connect() {
  if (conn) return conn;
  conn = new Promise((resolve, reject) => {
    const s = net.connect(process.env.PRISM_API);
    s.setEncoding('utf8');
    s.once('connect', () => { s.unref(); resolve(s); });
    s.once('error', e => { conn = null; reject(e); });
    s.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let r; try { r = JSON.parse(line); } catch { continue; }
        const w = waiting.get(r.id); if (!w) continue;
        waiting.delete(r.id);
        if (!waiting.size) s.unref();
        r.ok ? w.resolve(r) : w.reject(new Error(r.error || 'Prism refused the request'));
      }
    });
    s.on('close', () => { conn = null; for (const w of waiting.values()) w.reject(new Error('Prism closed the connection')); waiting.clear(); });
  });
  return conn;
}
async function request(op, fields = {}) {
  const s = await connect(), id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    s.ref();
    s.write(JSON.stringify({ id, op, tab: process.env.PRISM_TAB, ...fields }) + '\n');
  });
}
// Images and charts are drawn over lines the program leaves empty.
const reserve = rows => new Promise(r => process.stdout.write('\n'.repeat(Math.max(1, rows || 1)), r));

/** Show a picture (a file path or a Buffer). options: { width, height } in character cells. */
async function image(source, options = {}) {
  if (!available()) { console.log(`[image: ${typeof source === 'string' ? source : 'picture'}]`); return; }
  const fields = typeof source === 'string' ? { path: source, cwd: process.cwd() } : { data: Buffer.from(source).toString('base64') };
  const r = await request('image', { ...fields, ...options });
  await reserve(r.rows);
}

/** Draw a chart. spec: { type: 'line' | 'bar', title, labels: [...], series: [{ name, values: [...] }], height } */
async function chart(spec) {
  if (!available()) {
    const bars = ' ▁▂▃▄▅▆▇█';
    for (const s of spec.series || []) {
      const v = s.values || [], lo = Math.min(...v), hi = Math.max(...v);
      console.log(`${s.name || ''} ${v.map(x => bars[Math.round((x - lo) / ((hi - lo) || 1) * 8)]).join('')}`);
    }
    return;
  }
  const r = await request('chart', spec);
  await reserve(r.rows);
}

/** Buttons on the current line. Resolves to the chosen option, or null if cancelled. */
async function choose(prompt, options) {
  if (Array.isArray(prompt)) { options = prompt; prompt = ''; }
  if (!available()) return askText(`${prompt ? prompt + ' ' : ''}${options.map((o, i) => `[${i + 1}] ${o}`).join('  ')}: `).then(a => options[+a - 1] ?? (options.includes(a) ? a : null));
  const r = await request('choose', { prompt, options });
  process.stdout.write('\n');
  return r.cancelled ? null : r.choice;
}

/** A form. fields: [{ name, label, type: 'text'|'password'|'number'|'select'|'checkbox', options, value }]. Resolves to { name: value } or null. */
async function form(title, fields, submit) {
  if (!available()) {
    const out = {};
    for (const f of fields) {
      const a = await askText(`${f.label || f.name}${f.options && f.options.length ? ` (${f.options.join('/')})` : ''}: `);
      out[f.name] = f.type === 'checkbox' ? /^(y|yes|true|1)$/i.test(a) : f.type === 'number' ? Number(a) : a;
    }
    return out;
  }
  const r = await request('form', { title, fields, submit });
  return r.cancelled ? null : r.values;
}

/** Progress in the tab and on the taskbar button: 0-100, or null to hide it. state: 'normal' | 'error' | 'paused' */
async function progress(value, state = 'normal') {
  if (!available()) { if (value !== null) process.stderr.write(`\r${Math.round(value)}% `); return; }
  await request('progress', { value, state });
}

/** A Windows notification. */
async function notify(title, body = '') {
  if (!available()) { process.stdout.write('\x07'); console.log(`${title}${body ? ': ' + body : ''}`); return; }
  await request('notify', { title, body });
}

/** The tab title. */
async function title(text) {
  if (!available()) { process.stdout.write(`\x1b]0;${text}\x07`); return; }
  await request('title', { text });
}

function askText(q) {
  return new Promise(resolve => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); resolve(a.trim()); }); });
}

module.exports = { available, image, chart, choose, form, progress, notify, title, request };
