// Show in Diagram: vilket element en plats i koden gäller, och hur det ska visas i bilden.
const test = require('node:test');
const assert = require('node:assert/strict');
const { targetAt, resolveTarget } = require('../out/showInDiagram');
const { parseDiagram } = require('../out/diagram');

/** Platsen för första förekomsten av `word` på rad `line`. */
function at(text, line, word) {
  const m = parseDiagram(text);
  const target = targetAt(text, m, line, text.split('\n')[line].indexOf(word) + 1);
  return target && (target.kind === 'edge' ? `edge:${target.edge.key}` : `${target.kind}:${target.id}`);
}

const FLOW = 'flowchart LR\n  subgraph G [Grupp]\n    A[Start] --> B\n  end\n  B -->|klar| C\n\n  %% kommentar';

test('plats: namnet under markören gäller före resten av raden', () => {
  assert.equal(at(FLOW, 2, 'A'), 'node:A');
  assert.equal(at(FLOW, 2, 'B'), 'node:B');
  assert.equal(at(FLOW, 1, 'G'), 'subgraph:G');
});

test('plats: utan namn under markören gäller raden', () => {
  assert.equal(at(FLOW, 2, '-->'), 'edge:A->B#0');
  assert.equal(at(FLOW, 4, 'klar'), 'edge:B->C#0');
  assert.equal(at('flowchart LR\n  A[Start]', 1, 'Start'), 'node:A');
  assert.equal(at(FLOW, 1, 'Grupp'), 'subgraph:G');
  assert.equal(at(FLOW, 3, 'end'), 'subgraph:G');
});

test('plats: tomma rader, kommentarer och diagram som inte stöds gäller inget', () => {
  assert.equal(at(FLOW, 5, ''), undefined);
  assert.equal(at(FLOW, 6, 'kommentar'), undefined);
  assert.equal(at('pie\n  "A" : 1', 1, 'A'), undefined);
});

test('plats: en rad i en klass gäller klassen', () => {
  const text = 'classDiagram\n  namespace Shop {\n    class Kund {\n      +namn\n    }\n  }\n  Kund : +epost\n  <<service>> Kund\n  note for Kund "viktig"\n  Kund --> Order : gör';
  assert.equal(at(text, 3, 'namn'), 'node:Kund');
  assert.equal(at(text, 4, '}'), 'node:Kund');
  assert.equal(at(text, 6, 'epost'), 'node:Kund');
  assert.equal(at(text, 7, 'service'), 'node:Kund');
  assert.equal(at(text, 8, 'viktig'), 'node:Kund');
  assert.equal(at(text, 9, 'gör'), 'edge:Kund->Order#0');
  assert.equal(at(text, 1, 'Shop'), 'subgraph:Shop');
});

test('plats: block i sequence, och en gren gäller sitt block', () => {
  const text = 'sequenceDiagram\n  A->>B: hej\n  alt ok\n    B->>A: ja\n  else fel\n    B->>A: nej\n  end';
  const m = parseDiagram(text);
  const alt = [...m.blocks.values()].find(b => !b.section).id;
  assert.equal(at(text, 2, 'ok'), `block:${alt}`);
  assert.equal(at(text, 4, 'fel'), `block:${alt}`);
  assert.equal(at(text, 6, 'end'), `block:${alt}`);
  assert.equal(at(text, 1, 'hej'), 'edge:A->B#0');
});

const hide = (...keys) => new Set(keys);
const resolve = (text, target, hidden = hide()) => resolveTarget(parseDiagram(text), hidden, target);
const edge = (text, key) => ({ kind: 'edge', edge: parseDiagram(text).edges.find(e => e.key === key) });

test('visning: en synlig nod eller grupp visas som den är', () => {
  assert.deepEqual(resolve(FLOW, { kind: 'node', id: 'A' }), { kind: 'node', id: 'A' });
  assert.deepEqual(resolve(FLOW, { kind: 'subgraph', id: 'G' }), { kind: 'subgraph', id: 'G' });
});

test('visning: det som är dolt säger att det är dolt', () => {
  assert.deepEqual(resolve(FLOW, { kind: 'node', id: 'A' }, hide('n:A')), { hidden: 'A' });
  assert.deepEqual(resolve(FLOW, { kind: 'node', id: 'A' }, hide('s:G')), { hidden: 'A' });
  assert.deepEqual(resolve(FLOW, { kind: 'subgraph', id: 'G' }, hide('s:G')), { hidden: 'G' });
  assert.deepEqual(resolve(FLOW, edge(FLOW, 'B->C#0'), hide('e:B->C#0')), { hidden: 'B → C' });
});

test('visning: det som ligger i en hopfälld grupp visar gruppen', () => {
  assert.deepEqual(resolve(FLOW, { kind: 'node', id: 'A' }, hide('c:G')), { kind: 'subgraph', id: 'G' });
  assert.deepEqual(resolve(FLOW, { kind: 'subgraph', id: 'G' }, hide('c:G')), { kind: 'subgraph', id: 'G' });
});

test('visning: en pil med text visas med texten, en pil utan text med noden den går från', () => {
  assert.deepEqual(resolve(FLOW, edge(FLOW, 'B->C#0')), { kind: 'edgeText', text: 'klar', nth: 0 });
  assert.deepEqual(resolve(FLOW, edge(FLOW, 'A->B#0')), { kind: 'node', id: 'A' });
});

test('visning: samma text på flera pilar räknas bland de ritade', () => {
  const text = 'flowchart LR\n  A -->|ok| B\n  B -->|ok| C\n  C -->|ok| D';
  assert.deepEqual(resolve(text, edge(text, 'C->D#0')), { kind: 'edgeText', text: 'ok', nth: 2 });
  assert.deepEqual(resolve(text, edge(text, 'C->D#0'), hide('e:A->B#0')), { kind: 'edgeText', text: 'ok', nth: 1 });
});

test('visning: sequence räknar textrader i ordning, och dolda block säger att de är dolda', () => {
  const text = 'sequenceDiagram\n  A->>B: en<br/>två\n  B->>A: tre\n  loop x\n    A->>B: fyra\n  end';
  assert.deepEqual(resolve(text, edge(text, 'B->A#0')), { kind: 'edgeText', index: 2 });
  const loop = [...parseDiagram(text).blocks.keys()][0];
  assert.deepEqual(resolve(text, { kind: 'block', id: loop }), { kind: 'block', id: loop });
  assert.deepEqual(resolve(text, { kind: 'block', id: loop }, hide(`s:${loop}`)), { hidden: loop });
});
