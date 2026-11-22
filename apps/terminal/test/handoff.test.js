'use strict';
// The Prism side of the default-terminal handoff, against a fake prism-handoff.exe speaking the same frames.
const assert = require('assert');
const net = require('net');
const os = require('os');
const path = require('path');
const { startHandoffServer } = require('../src/handoff');

const sock = process.platform === 'win32' ? `\\\\.\\pipe\\prism-handoff-test-${process.pid}` : path.join(os.tmpdir(), `prism-handoff-${process.pid}.sock`);
const frame = (type, body) => { const b = Buffer.isBuffer(body) ? body : Buffer.from(body || ''); const h = Buffer.alloc(5); h[0] = type; h.writeUInt32LE(b.length, 1); return Buffer.concat([h, b]); };

const server = startHandoffServer(con => {
  assert.strictEqual(con.hello.title, 'cmd');
  assert.strictEqual(con.pid, 42);
  let out = '';
  con.onData(d => { out += d; });
  con.onExit(({ exitCode }) => {
    assert.strictEqual(out, 'hello ✓ world');
    assert.strictEqual(exitCode, 3);
    con.write('ls\r'); con.resize(120, 40); con.kill();
  });
}, sock);

server.on('listening', () => {
  const c = net.connect(sock);
  let got = Buffer.alloc(0);
  c.on('data', d => { got = Buffer.concat([got, d]); });
  c.on('close', () => {
    // input, resize (u16 cols, u16 rows), close
    assert.deepStrictEqual([...got.subarray(0, 5)], [1, 3, 0, 0, 0]);
    assert.strictEqual(got.subarray(5, 8).toString(), 'ls\r');
    assert.strictEqual(got[8], 2); assert.strictEqual(got.readUInt16LE(13), 120); assert.strictEqual(got.readUInt16LE(15), 40);
    assert.strictEqual(got[17], 3);
    server.close();
    console.log('OK: handoff protocol');
  });
  const text = Buffer.from('hello ✓ world');
  // split a multi-byte character across frames, and frames across writes
  c.write(Buffer.concat([frame(1, '{"title":"cmd","pid":42,"exe":"C:\\\\Windows\\\\System32\\\\cmd.exe"}'), frame(2, text.subarray(0, 7))]).subarray(0, 20));
  setTimeout(() => c.write(Buffer.concat([frame(1, '{"title":"cmd","pid":42,"exe":"C:\\\\Windows\\\\System32\\\\cmd.exe"}'), frame(2, text.subarray(0, 7))]).subarray(20)), 20);
  setTimeout(() => c.write(Buffer.concat([frame(2, text.subarray(7)), frame(3, '{"code":3}')])), 40);
});
const { newer } = require('../src/updater');
for (const [a, b, r] of [['0.7.0', '0.6.0', true], ['0.6.0', '0.6.0', false], ['0.10.0', '0.9.9', true], ['1.0.0', '0.99.0', true], ['0.6.0', '0.6.1', false]]) assert.strictEqual(newer(a, b), r, `${a} > ${b}`);
console.log('OK: version comparison');
setTimeout(() => { console.error('handoff test timed out'); process.exit(1); }, 5000).unref();
