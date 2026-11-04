// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* The block round trip over cad.like.audio/host@1, run against the VENDORED
   apk-softapp.js in a stub window (apk-softapp.test.js's world()/fire()). */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { linkBlock, discoveredRows } from '../js/softappLink.js';
import { PowerChainModel } from '../js/powerChainModel.js';

const EDITOR = 'Power Chain Editor';
const BLOCK_TYPE = 'powerchain';
const Model = PowerChainModel;
const filename = (m) => m.panelName.toLowerCase().replace(/\s+/g, '_');
const sample = () => (() => { const b = new PowerChainModel().toJSON(); b.id = 'power_fixture'; b.panelName = 'PANEL-FX9'; b.circuits[0].label = 'A <b>tagged</b> title'; return b; })();

const ORIGIN = 'http://bench:8080';
const SRC = fs.readFileSync(fileURLToPath(new URL('../vendor/apk-softapp/apk-softapp.js', import.meta.url)), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));

function world({ framed = true } = {}) {
  const listeners = [];
  const toParent = [];
  const downloads = [];
  const body = { children: [], appendChild(n) { this.children.push(n); return n; } };
  const doc = {
    title: 'Test Editor',
    body,
    documentElement: { style: { setProperty() {} } },
    getElementById: (id) => body.children.find((n) => n.id === id) || null,
    createElement: (tag) => ({
      tag, style: {}, attrs: {}, textContent: '',
      setAttribute(k, v) { this.attrs[k] = v; },
      click() { downloads.push({ name: this.download }); },
      remove() {},
    }),
  };
  const win = {
    location: { origin: ORIGIN },
    document: doc,
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    removeEventListener() {},
    Blob: class { constructor(parts, o) { this.text = parts.join(''); this.type = o.type; } },
    URL: { createObjectURL: (b) => { downloads.blob = b; return 'blob:1'; }, revokeObjectURL() {} },
    setTimeout: (fn) => { fn(); return 1; },
    setInterval: () => 1, clearInterval() {},
    JSON, Date, Math, Promise, Object, Array, String, Number, isFinite, parseInt, RegExp,
  };
  win.window = win; win.globalThis = win;
  const parent = { postMessage: (m, o) => toParent.push({ m: plain(m), o }) };
  win.parent = framed ? parent : win;
  vm.runInNewContext(SRC, win);
  const fire = (data, { source = parent, origin = ORIGIN } = {}) => listeners.slice().forEach((fn) => fn({ data, source, origin }));
  return { S: win.APKSoftapp, toParent, downloads, fire };
}

function linked(w) {
  let model = new Model();
  const loads = [];
  const link = linkBlock(w.S, {
    editor: EDITOR, blockType: BLOCK_TYPE, Model, filename,
    getModel: () => model,
    setModel: (m, meta) => { model = m; loads.push(meta); },
  });
  return { link, loads, model: () => model };
}

test('in the CAD: editorReady at our origin, load → model, request → blockSave of the same block', () => {
  const w = world();
  const { loads, model } = linked(w);
  assert.deepEqual(w.toParent[0], { m: { protocol: 'cad.like.audio/host@1', type: 'editorReady', editor: EDITOR, blockType: BLOCK_TYPE }, o: ORIGIN });

  const block = sample();
  w.fire({ protocol: 'cad.like.audio/host@1', type: 'load', block, meta: { blockName: 'B1' } });
  assert.equal(loads.length, 1);
  assert.deepEqual(plain(model().toJSON()), plain(block));

  w.fire({ protocol: 'cad.like.audio/host@1', type: 'request' });
  const save = w.toParent.at(-1);
  assert.equal(save.o, ORIGIN);
  assert.equal(save.m.type, 'blockSave');
  assert.equal(save.m.blockType, BLOCK_TYPE);
  assert.deepEqual(save.m.block, plain(block));
  assert.equal(save.m.meta.filename, filename(model()));
  assert.equal(w.downloads.length, 0, 'no download when embedded');
  assert.ok(w.toParent.every((p) => p.o === ORIGIN), 'only ever our own origin');
});

test('in the CAD: changed() and save() post blockChanged / blockSave, never a download', () => {
  const w = world();
  const { link } = linked(w);
  link.changed();
  assert.equal(w.toParent.at(-1).m.type, 'blockChanged');
  assert.equal(link.save(), 'host');
  assert.equal(w.toParent.at(-1).m.type, 'blockSave');
  assert.equal(w.downloads.length, 0);
});

test('messages from another origin or another window are ignored', () => {
  const w = world();
  const { loads } = linked(w);
  w.fire({ protocol: 'cad.like.audio/host@1', type: 'load', block: sample() }, { origin: 'http://evil' });
  w.fire({ protocol: 'cad.like.audio/host@1', type: 'load', block: sample() }, { source: {} });
  w.fire({ type: ['APK', 'LOAD', 'BLOCK'].join('_'), block: sample() }); // the old private message
  assert.equal(loads.length, 0);
});

test('standalone: save() downloads <filename>.json of the model', () => {
  const w = world({ framed: false });
  const { link, model } = linked(w);
  link.openLocal(sample(), { filename: 'x.json' });
  assert.equal(link.save(), 'download');
  assert.equal(w.downloads[0].name, `${filename(model())}.json`);
  assert.deepEqual(JSON.parse(w.downloads.blob.text), plain(sample()));
});

test('discovered rows key on MAC / serial and carry live state, never an IP as identity', () => {
  const rows = discoveredRows([
    { id: 'x', mac: 'aa:bb:cc:dd:ee:ff', name: 'sw1', ips: ['10.0.0.2'], protocols: ['snmp'], live: { state: 'good', why: 'seen 3s ago' } },
    { id: 'y', serial: 'SN1', ips: ['10.0.0.3'], live: { state: 'kinda', why: 'unverified 6 min' } },
    { id: 'z', ips: ['10.0.0.4'] },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['aa:bb:cc:dd:ee:ff', 'SN1', 'z']);
  assert.deepEqual(rows.map((r) => r.state), ['good', 'kinda', 'dead']);
  assert.equal(rows[0].ips, '10.0.0.2');
});

test('text from a loaded block is escaped in the drawn single-line diagram', async () => {
  const { renderPowerDiagramSvg } = await import('../js/powerChainSvg.js');
  const m = new Model(sample());
  const svg = renderPowerDiagramSvg(m, {});
  assert.ok(!svg.includes('<b>'));
  assert.ok(svg.includes('A &lt;b&gt;tagged&lt;/b&gt; title'));
});
