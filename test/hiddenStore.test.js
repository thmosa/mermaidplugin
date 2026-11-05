// Vad som är dolt och hopfällt per fil. Som standard glöms det när filen stängs, så att allt
// syns när den öppnas igen; med inställningen mermaidTree.rememberHiddenState sparas det.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HiddenStore } = require('../out/hiddenStore');

/** Som VS Codes workspaceState. */
function memento(initial = {}) {
  const data = { ...initial };
  return { data, get: (k, d) => k in data ? data[k] : d, update: (k, v) => { data[k] = v; return Promise.resolve(); } };
}

test('dolt: utan inställningen syns allt i en fil som öppnas, även om något sparats tidigare', () => {
  const store = new HiddenStore(memento({ 'mermaidTree.hidden': { 'file:///a.mmd': ['n:A'] } }), () => false);
  assert.deepEqual(store.load('file:///a.mmd'), []);
});

test('dolt: utan inställningen minns filen sitt dolda tills den stängs', () => {
  const backing = memento();
  const store = new HiddenStore(backing, () => false);
  store.save('file:///a.mmd', ['n:A', 'c:G']);
  store.save('file:///b.mmd', ['n:B']);
  assert.deepEqual(store.load('file:///a.mmd'), ['n:A', 'c:G']);
  store.forget('file:///a.mmd');
  assert.deepEqual(store.load('file:///a.mmd'), []);
  assert.deepEqual(store.load('file:///b.mmd'), ['n:B']);
  // Inget skrivs till arbetsytans lagring.
  assert.deepEqual(backing.data, {});
});

test('dolt: med inställningen sparas det i arbetsytan och finns kvar efter stängning', () => {
  const backing = memento();
  const store = new HiddenStore(backing, () => true);
  store.save('file:///a.mmd', ['n:A']);
  store.forget('file:///a.mmd');
  assert.deepEqual(new HiddenStore(backing, () => true).load('file:///a.mmd'), ['n:A']);
});

test('dolt: inställningen finns i package.json, av som standard', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const setting = pkg.contributes.configuration?.properties?.['mermaidTree.rememberHiddenState'];
  assert.ok(setting, 'inställningen saknas');
  assert.equal(setting.type, 'boolean');
  assert.equal(setting.default, false);
  assert.match(setting.description, /[A-Z]/);
});
