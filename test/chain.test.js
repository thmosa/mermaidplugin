// Focus: kedjan av pilar från en nod eller grupp, ut, in eller in och ut.
const test = require('node:test');
const assert = require('node:assert/strict');
const { arrowDirection, chain } = require('../out/chain');
const { parseDiagram } = require('../out/diagram');

const sorted = set => [...set].sort();

// ------------------------------------------------------------ pilens riktning

test('riktning: klassrelationer följer pilen, och en romb pekar från helheten till delen', () => {
  const cases = {
    '-->': 'forward', '..>': 'forward', '--|>': 'forward', '..|>': 'forward',
    '<--': 'backward', '<..': 'backward', '<|--': 'backward', '<|..': 'backward',
    '*--': 'forward', 'o--': 'forward', '--*': 'backward', '--o': 'backward',
    '--': 'both', '..': 'both', '<-->': 'both', '<|--|>': 'both', '*--*': 'both', '()--': 'both', '--()': 'both',
  };
  for (const [arrow, dir] of Object.entries(cases)) assert.equal(arrowDirection(arrow, 'class'), dir, arrow);
});

test('riktning: flowchart följer pilspetsen (> o x); en länk utan spets gäller åt båda hållen', () => {
  const cases = {
    '-->': 'forward', '==>': 'forward', '-.->': 'forward', '--o': 'forward', '--x': 'forward', '---->': 'forward',
    '-- text -->': 'forward', 'e1@-->': 'forward', '-->|text|': 'forward',
    '---': 'both', '===': 'both', '-.-': 'both', '~~~': 'both', '<-->': 'both', 'o--o': 'both', 'x--x': 'both', '-- text ---': 'both',
  };
  for (const [arrow, dir] of Object.entries(cases)) assert.equal(arrowDirection(arrow, 'flow'), dir, arrow);
});

test('riktning: kanterna i class diagram och flowchart får sin riktning', () => {
  const cls = parseDiagram('classDiagram\n  Order *-- Rad\n  Maskin <|-- CNC\n  A -- B\n  Kund --> Order');
  assert.deepEqual(cls.edges.map(e => e.dir), ['forward', 'backward', 'both', 'forward']);
  const flow = parseDiagram('flowchart LR\n  a --> b\n  b --- c\n  c <--> d');
  assert.deepEqual(flow.edges.map(e => e.dir), ['forward', 'both', 'both']);
});

// ------------------------------------------------------------ kedjan

const state = parseDiagram(`stateDiagram-v2
  a --> b
  b --> c
  c --> d
  x --> b`);

test('kedja: i pilarnas riktning, ett steg eller alla', () => {
  assert.deepEqual(sorted(chain(state, { kind: 'node', id: 'b' }, 'follow', 1)), ['b', 'c']);
  assert.deepEqual(sorted(chain(state, { kind: 'node', id: 'b' }, 'follow', Infinity)), ['b', 'c', 'd']);
});

test('kedja: mot pilarna och åt båda hållen', () => {
  assert.deepEqual(sorted(chain(state, { kind: 'node', id: 'b' }, 'against', Infinity)), ['a', 'b', 'x']);
  assert.deepEqual(sorted(chain(state, { kind: 'node', id: 'b' }, 'both', 1)), ['a', 'b', 'c', 'x']);
  assert.deepEqual(sorted(chain(state, { kind: 'node', id: 'c' }, 'both', 2)), ['a', 'b', 'c', 'd', 'x']);
});

test('kedja: class diagram, det en klass består av och ärver, men inte det som använder den', () => {
  const cls = parseDiagram(`classDiagram
  Order *-- Rad
  Rad --> Produkt
  Kund --> Order
  Order <|-- ExpressOrder
  Produkt -- Kategori`);
  assert.deepEqual(sorted(chain(cls, { kind: 'node', id: 'Order' }, 'follow', Infinity)), ['Kategori', 'Order', 'Produkt', 'Rad']);
  assert.deepEqual(sorted(chain(cls, { kind: 'node', id: 'ExpressOrder' }, 'follow', 1)), ['ExpressOrder', 'Order']);
  assert.deepEqual(sorted(chain(cls, { kind: 'node', id: 'Order' }, 'against', Infinity)), ['ExpressOrder', 'Kund', 'Order']);
});

test('kedja: från en grupp börjar den i allt i gruppen', () => {
  const flow = parseDiagram('flowchart LR\n  subgraph S\n    a --> b\n  end\n  b --> c\n  c --> d\n  x --> a');
  const nodes = set => sorted(set).filter(id => flow.nodes.has(id));
  assert.deepEqual(nodes(chain(flow, { kind: 'subgraph', id: 'S' }, 'follow', 1)), ['a', 'b', 'c']);
  assert.deepEqual(nodes(chain(flow, { kind: 'subgraph', id: 'S' }, 'follow', Infinity)), ['a', 'b', 'c', 'd']);
  assert.deepEqual(nodes(chain(flow, { kind: 'subgraph', id: 'S' }, 'against', Infinity)), ['a', 'b', 'x']);
  assert.ok(chain(flow, { kind: 'subgraph', id: 'S' }, 'follow', 1).has('S'));
});

// ------------------------------------------------------------ förval innan något är sparat

const { defaultChain, chainFamily } = require('../out/chain');

test('förval: in och ut, hela kedjan, i alla diagramtyper (det Focus-knappen gör)', () => {
  for (const t of ['classDiagram', 'stateDiagram-v2', 'flowchart', 'graph', 'sequenceDiagram']) assert.deepEqual(defaultChain(t), { direction: 'both', steps: Infinity }, t);
});

test('valet sparas per diagramtyp: varianter av samma typ delar val', () => {
  assert.equal(chainFamily('stateDiagram-v2'), chainFamily('stateDiagram'));
  assert.equal(chainFamily('flowchart'), chainFamily('graph'));
  assert.equal(chainFamily('classDiagram-v2'), chainFamily('classDiagram'));
  assert.notEqual(chainFamily('classDiagram'), chainFamily('stateDiagram-v2'));
});

test('kedja: in och ut från objektet, där varje gren fortsätter i sin riktning (B --> a, B --> c ger inte c)', () => {
  const m = parseDiagram('stateDiagram-v2\n  B --> a\n  B --> c\n  c --> d\n  a --> e\n  e --> f\n  g --> e\n  Z --> B');
  // In: B och Z leder hit. Ut: e och f kommer efter. c, d och g hänger ihop men leder inte hit och kommer inte efter.
  assert.deepEqual(sorted(chain(m, { kind: 'node', id: 'a' }, 'both', Infinity)), ['B', 'Z', 'a', 'e', 'f']);
  assert.deepEqual(sorted(chain(m, { kind: 'node', id: 'a' }, 'both', 1)), ['B', 'a', 'e']);
});

// ------------------------------------------------------------ den sammansatta statens pilar

const nested = parseDiagram(`stateDiagram-v2
  Other --> Start
  Start --> Outer
  state Outer {
    [*] --> a
    a --> b
    state Inner {
      x
    }
  }
  Outer --> Done
  Done --> End
  Side --> Done`);
const real = set => sorted(set).filter(id => nested.nodes.has(id) && !nested.nodes.get(id).pseudo);

test('kedja: pilar till och från en sammansatt state gäller också det som ligger i den', () => {
  assert.deepEqual(real(chain(nested, { kind: 'node', id: 'a' }, 'follow', Infinity)), ['Done', 'End', 'a', 'b']);
  assert.deepEqual(real(chain(nested, { kind: 'node', id: 'a' }, 'against', Infinity)), ['Other', 'Start', 'a']);
  assert.deepEqual(real(chain(nested, { kind: 'node', id: 'a' }, 'both', 1)), ['Done', 'Start', 'a', 'b']);
});

test('kedja: även flera nivåer ner (x ligger i Inner som ligger i Outer)', () => {
  assert.deepEqual(real(chain(nested, { kind: 'node', id: 'x' }, 'both', Infinity)), ['Done', 'End', 'Other', 'Start', 'x']);
});

// ------------------------------------------------------------ vad fokus döljer

const { focusHidden } = require('../out/chain');

test('fokus döljer också grupper utanför kedjan, så att en pil mellan två grupper inte står kvar', () => {
  const m = parseDiagram(`stateDiagram-v2
  state G1 {
    a --> b
  }
  state G2 {
    c
  }
  state G3 {
    d
  }
  G2 --> G3
  b --> e`);
  const keep = chain(m, { kind: 'node', id: 'a' }, 'both', Infinity);
  const hidden = focusHidden(m, keep);
  for (const k of ['s:G2', 's:G3', 'n:c', 'n:d']) assert.ok(hidden.includes(k), `${k} ska döljas: ${hidden}`);
  for (const k of ['s:G1', 'n:a', 'n:b', 'n:e']) assert.ok(!hidden.includes(k), `${k} ska synas`);
});

test('fokus döljer inte en grupp som kedjan når via en pil, eller som har något i kedjan', () => {
  const m = parseDiagram(`stateDiagram-v2
  x --> Outer
  state Outer {
    state Inner {
      y
    }
  }
  state Other {
    z
  }`);
  const hidden = focusHidden(m, chain(m, { kind: 'node', id: 'x' }, 'both', Infinity));
  assert.ok(!hidden.includes('s:Outer'), 'Outer nås av pilen');
  assert.ok(hidden.includes('s:Other'));
  const inner = focusHidden(m, chain(m, { kind: 'node', id: 'y' }, 'both', 1));
  assert.ok(!inner.includes('s:Outer') && !inner.includes('s:Inner'), `${inner}`);
});
