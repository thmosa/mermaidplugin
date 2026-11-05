// Semantisk färgläggning: parsern talar om vad varje namn är, så att temat färgar rätt även där
// grammatiken bara kan gissa. Typerna är VS Codes standardtyper, som alla teman känner till.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { semanticTokens, LEGEND } = require('../out/semantic');
const { parseDiagram } = require('../out/diagram');
const { occurrences, renamable } = require('../out/rename');

const tokens = text => semanticTokens(text, parseDiagram(text));
const show = (text, list) => list.map(t => `${text.split('\n')[t.line].slice(t.start, t.start + t.length)}:${t.type}${t.modifiers.length ? '+' + t.modifiers.join('+') : ''}`);

test('semantik: deltagare, tillstånd och noder är type, grupper namespace, klasser class', () => {
  const seq = 'sequenceDiagram\n  participant API as API-gateway\n  API->>Order: skapa Order';
  assert.deepEqual(show(seq, tokens(seq)), ['API:type+declaration', 'API:type', 'Order:type+declaration']);
  const state = 'stateDiagram-v2\n  [*] --> Idle\n  state Busy {\n    Work\n  }\n  Idle --> Busy : go';
  assert.deepEqual(show(state, tokens(state)), ['Idle:type+declaration', 'Busy:namespace+declaration', 'Work:type+declaration', 'Idle:type', 'Busy:namespace']);
  const cls = 'classDiagram\n  namespace Shop {\n    class Cart\n  }\n  Cart --> Item : has';
  assert.deepEqual(show(cls, tokens(cls)), ['Shop:namespace+declaration', 'Cart:class+declaration', 'Cart:class', 'Item:class+declaration']);
  const flow = 'flowchart LR\n  subgraph G [Grupp]\n    A[Start] --> B\n  end';
  assert.deepEqual(show(flow, tokens(flow)), ['G:namespace+declaration', 'A:type+declaration', 'B:type+declaration']);
});

test('semantik: bara typer och modifierare som finns i legenden, i ordning och utan överlapp', () => {
  for (const file of fs.readdirSync(path.join(__dirname, '..', 'samples')).filter(f => f.endsWith('.mmd'))) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'samples', file), 'utf8');
    const list = tokens(text);
    for (const t of list) {
      assert.ok(LEGEND.tokenTypes.includes(t.type), `${file}: ${t.type}`);
      for (const m of t.modifiers) assert.ok(LEGEND.tokenModifiers.includes(m), `${file}: ${m}`);
    }
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]];
      assert.ok(a.line < b.line || (a.line === b.line && a.start + a.length <= b.start), `${file}: överlapp eller fel ordning rad ${b.line + 1}`);
    }
  }
});

test('semantik: varje användning av ett namn får en token, precis som namnbytet hittar dem', () => {
  for (const file of fs.readdirSync(path.join(__dirname, '..', 'samples')).filter(f => f.endsWith('.mmd'))) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'samples', file), 'utf8');
    const model = parseDiagram(text);
    const want = renamable(model).flatMap(id => occurrences(text, model, id)).map(o => `${o.line}:${o.start}:${o.end - o.start}`).sort();
    const got = tokens(text).map(t => `${t.line}:${t.start}:${t.length}`).sort();
    assert.deepEqual(got, want, file);
  }
});

test('semantik: legendens typer får en egen färg i VS Codes inbyggda teman (inte variable)', () => {
  assert.ok(!LEGEND.tokenTypes.includes('variable'));
  assert.deepEqual([...LEGEND.tokenTypes].sort(), ['class', 'namespace', 'type']);
  assert.deepEqual(LEGEND.tokenModifiers, ['declaration']);
});
