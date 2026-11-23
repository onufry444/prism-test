'use strict';
// Plugins load from folders; the Prism API checks requests before they reach a pane.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Plugins } = require('../src/plugins');
const { PrismApi, sniff } = require('../src/api');
const { Themes, validTheme } = require('../src/themes');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-plugins-'));
  fs.cpSync(path.join(__dirname, '..', '..', '..', 'examples', 'plugins', 'hello'), path.join(dir, 'hello'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'broken')); fs.writeFileSync(path.join(dir, 'broken', 'plugin.json'), '{"name":"broken"}'); fs.writeFileSync(path.join(dir, 'broken', 'index.js'), 'throw new Error("oops")');
  let off = [];
  const pl = new Plugins({ dir, disabled: () => off, builtin: new Set(['lava']), fetch: null, onChange() {} }).load();
  const hello = pl.list.find(p => p.name === 'hello');
  assert.deepStrictEqual(hello.commands, ['hello']); assert.deepStrictEqual(hello.animations, ['fire']); assert.deepStrictEqual(hello.schemes, ['ember']);
  assert.ok(/oops/.test(pl.list.find(p => p.name === 'broken').error), 'a broken plugin reports its error and does not stop the others');
  const out = await pl.commands.get('hello').fn({ version: '1.2.3' }, ['Ada']);
  assert.ok(out.replace(/\x1b\[[0-9;]*m/g, '').startsWith('Hello, Ada! This is Prism 1.2.3.'));
  off = ['hello']; pl.load();
  assert.ok(!pl.commands.has('hello') && pl.list.find(p => p.name === 'hello').enabled === false, 'a switched-off plugin adds nothing');
  console.log('OK: plugins');

  // API checks
  const shown = [];
  const api = new PrismApi({ pane: id => (id === 'p1' ? { request: async (op, payload) => { shown.push([op, payload]); return { rows: 3 }; } } : null), notify() {}, progress() {} });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.strictEqual((await api.handle({ op: 'hello' })).version, 1);
  assert.deepStrictEqual(await api.handle({ op: 'image', tab: 'p1', data: png }), { rows: 3 });
  assert.ok(shown[0][1].src.startsWith('data:image/png;base64,'));
  await assert.rejects(api.handle({ op: 'image', tab: 'p1', data: Buffer.from('not an image').toString('base64') }), /not an image/);
  await assert.rejects(api.handle({ op: 'image', tab: 'other', data: png }), /Prism pane/);
  await assert.rejects(api.handle({ op: 'run', tab: 'p1' }), /unknown request/);
  await assert.rejects(api.handle({ op: 'choose', tab: 'p1', options: [] }), /options/);
  await api.handle({ op: 'chart', tab: 'p1', series: [{ name: 'a', values: [1, 'x', 3] }] });
  assert.deepStrictEqual(shown[1][1].series[0].values, [1, null, 3]);
  assert.strictEqual(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), 'image/svg+xml');
  console.log('OK: api requests');

  // themes
  assert.strictEqual(validTheme({ name: 'x', colors: { background: '#000000' } }), null, 'a theme needs a foreground');
  const t = validTheme(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'store', 'themes', 'aurora.json'), 'utf8')));
  assert.ok(t && t.background && t.brightWhite && t.accent);
  const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'store', 'index.json'), 'utf8'));
  for (const e of idx.themes) assert.ok(fs.existsSync(path.join(__dirname, '..', '..', '..', 'store', 'themes', `${e.id}.json`)), `store file for ${e.id}`);
  const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-themes-'));
  const th = new Themes({ dir: tdir, fetch: null, repo: () => 'x/y' });
  th.save('mine', { name: 'Mine', colors: { background: '#101010', foreground: '#eeeeee' } });
  assert.ok(th.load().mine.own);
  console.log('OK: themes');
})().catch(e => { console.error(e); process.exit(1); });
