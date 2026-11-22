'use strict';
// Receives consoles that Windows hands to Prism (see native/handoff.cpp for the other end).
// Each connection is one console app; it becomes a Prism tab through a pty-like object.
const net = require('net');
const os = require('os');

const pipeName = () => `\\\\.\\pipe\\prism-handoff-${(os.userInfo().username || 'user').replace(/[^A-Za-z0-9_-]/g, '_')}`;

// pty-like wrapper around one handed-off console
class HandedOffConsole {
  constructor(sock, hello) {
    this.sock = sock; this.hello = hello; this.pid = hello.pid || 0;
    this.dataCbs = []; this.exitCbs = []; this.buffer = []; this.exited = null;
  }
  frame(type, payload) {
    if (this.sock.destroyed) return;
    const b = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '', 'utf8');
    const h = Buffer.alloc(5); h[0] = type; h.writeUInt32LE(b.length, 1);
    this.sock.write(Buffer.concat([h, b]));
  }
  write(d) { this.frame(1, d); }
  resize(cols, rows) { const b = Buffer.alloc(4); b.writeUInt16LE(Math.max(1, Math.min(cols, 32767)), 0); b.writeUInt16LE(Math.max(1, Math.min(rows, 32767)), 2); this.frame(2, b); }
  kill() { this.frame(3); setTimeout(() => this.sock.destroy(), 500); }
  onData(cb) { this.dataCbs.push(cb); for (const d of this.buffer.splice(0)) cb(d); }
  onExit(cb) { this.exitCbs.push(cb); if (this.exited) cb(this.exited); }
  _data(d) { if (this.dataCbs.length) this.dataCbs.forEach(cb => cb(d)); else this.buffer.push(d); }
  _exit(code) { if (this.exited) return; this.exited = { exitCode: code }; this.exitCbs.forEach(cb => cb(this.exited)); }
}

function startHandoffServer(onConsole, name) {
  if (process.platform !== 'win32' && !name) return null;
  const server = net.createServer(sock => {
    let buf = Buffer.alloc(0), con = null;
    const dec = new (require('string_decoder').StringDecoder)('utf8');
    sock.on('error', () => {});
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 5) {
        const len = buf.readUInt32LE(1);
        if (buf.length < 5 + len) break;
        const type = buf[0], body = buf.subarray(5, 5 + len);
        buf = buf.subarray(5 + len);
        if (type === 1 && !con) {
          let hello = {}; try { hello = JSON.parse(body.toString('utf8')); } catch {}
          con = new HandedOffConsole(sock, hello);
          onConsole(con);
        } else if (type === 2 && con) con._data(dec.write(body));
        else if (type === 3 && con) { let c = 0; try { c = JSON.parse(body.toString('utf8')).code | 0; } catch {} con._exit(c); }
      }
    });
    sock.on('close', () => { if (con) con._exit(con.exited ? con.exited.exitCode : 0); });
  });
  server.on('error', e => console.error('Prism: handoff pipe', e.message));
  server.listen(name || pipeName());
  return server;
}

module.exports = { startHandoffServer, pipeName };
