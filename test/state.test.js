const test = require('node:test');
const assert = require('node:assert/strict');
const { parseState, filterState } = require('../out/stateParser');
const { nodeKey, edgeKey, subgraphKey, visibility, neighborhood } = require('../out/parser');

const demo = `---
title: Exempel
---
stateDiagram-v2
  %% kommentar
  direction LR
  classDef hot fill:#f99
  [*] --> Still
  Still --> [*]
  Still --> Moving : går
  state "Rörelse" as Moving
  Moving --> Crash
  state Crash {
    [*] --> Larm
    Larm --> Sammanställ
    Sammanställ --> [*]
  }
  Crash --> [*]
  state val <<choice>>
  Still --> val
  val --> Moving : ja
  note right of Still : vilar
  note left of Crash
    X --> Y står här
    men är bara text
  end note
  class Moving hot`;

const lineOf = (text, needle) => text.split('\n').findIndex(l => l.includes(needle));

test('state: känner igen stateDiagram och stateDiagram-v2, men inte andra typer', () => {
  assert.equal(parseState('stateDiagram-v2\n  A --> B').supported, true);
  assert.equal(parseState('stateDiagram\n  A --> B').supported, true);
  const m = parseState('flowchart LR\n  A --> B');
  assert.equal(m.supported, false);
  assert.equal(m.diagramType, 'flowchart');
});

test('state: tolkar tillstånd, övergångar med etikett och radnummer', () => {
  const m = parseState(demo);
  assert.equal(m.supported, true);
  assert.equal(m.diagramType, 'stateDiagram-v2');
  assert.deepEqual([...m.nodes.keys()].sort(),
    ['Crash_end', 'Crash_start', 'Larm', 'Moving', 'Still', 'Sammanställ', 'root_end', 'root_start', 'val'].sort());
  const e = m.edges.find(x => x.from === 'Still' && x.to === 'Moving');
  assert.equal(e.label, 'går');
  assert.equal(e.line, lineOf(demo, 'Still --> Moving'));
  assert.equal(e.key, 'Still->Moving#0');
  assert.equal(m.edges.length, 10);
  assert.deepEqual(m.edges.map(x => x.index), [...m.edges.keys()]);
});

test('state: [*] blir start/slut i sitt eget sammansatta tillstånd', () => {
  const m = parseState(demo);
  assert.deepEqual(m.edges.filter(x => x.from.endsWith('_start') || x.to.endsWith('_end')).map(x => x.key).sort(),
    ['Crash->root_end#0', 'Crash_start->Larm#0', 'Sammanställ->Crash_end#0', 'Still->root_end#0', 'root_start->Still#0']);
  assert.equal(m.nodes.get('root_start').pseudo, 'start');
  assert.equal(m.nodes.get('root_end').pseudo, 'end');
  assert.equal(m.nodes.get('root_start').label, 'Start');
  assert.equal(m.nodes.get('root_end').label, 'End');
  assert.equal(m.nodes.get('Crash_start').subgraph, 'Crash');
  assert.equal(m.nodes.get('root_start').subgraph, undefined);
});

test('state: sammansatta tillstånd blir subgrafer, även med alias och nästling', () => {
  const m = parseState('stateDiagram-v2\n  state "Stor grupp" as G {\n    x --> y\n    state Inner {\n      a\n    }\n  }\n  G --> z');
  assert.deepEqual([...m.subgraphs.keys()].sort(), ['G', 'Inner']);
  assert.equal(m.subgraphs.get('G').title, 'Stor grupp');
  assert.equal(m.subgraphs.get('G').line, 1);
  assert.equal(m.subgraphs.get('G').endLine, 6);
  assert.equal(m.subgraphs.get('Inner').parent, 'G');
  assert.equal(m.nodes.get('x').subgraph, 'G');
  assert.equal(m.nodes.get('a').subgraph, 'Inner');
  assert.equal(m.nodes.has('G'), false, 'ett sammansatt tillstånd är en subgraf, inte en nod');
  assert.deepEqual(m.edges.map(e => e.key), ['x->y#0', 'G->z#0']);
});

test('state: alias ger etikett och raden där aliaset står', () => {
  const m = parseState(demo);
  assert.equal(m.nodes.get('Moving').label, 'Rörelse');
  assert.equal(m.nodes.get('Moving').line, lineOf(demo, 'as Moving'));
  assert.equal(m.nodes.get('Still').label, 'Still');
});

test('state: "state B" ensamt ger ingen nod (Mermaid ritar den inte), men "B", "B : text" och "B:::c" gör det', () => {
  const m = parseState('stateDiagram-v2\n  state B\n  A\n  C : beskrivning\n  D:::hot\n  state f <<fork>>');
  assert.deepEqual([...m.nodes.keys()].sort(), ['A', 'C', 'D', 'f']);
  const m2 = parseState('stateDiagram-v2\n  state B\n  B --> C');
  assert.deepEqual([...m2.nodes.keys()].sort(), ['B', 'C']);
});

test('state: klass på övergång, anteckningar, -- och kommentarer skapar inga extra tillstånd', () => {
  const m = parseState('stateDiagram-v2\n  A:::hot --> B\n  note right of A : X --> Y\n  note left of B\n    P --> Q\n  end note\n  state R {\n    r1\n    --\n    r2\n  }');
  assert.deepEqual([...m.nodes.keys()].sort(), ['A', 'B', 'r1', 'r2']);
  assert.deepEqual(m.edges.map(e => e.key), ['A->B#0']);
});

test('state: utan något dolt blir texten identisk', () => {
  assert.equal(filterState(parseState(demo), new Set()), demo);
});

test('state: dold nod tar bort dess övergångar, alias, anteckningar och klassreferenser', () => {
  const out = filterState(parseState(demo), new Set([nodeKey('Moving')]));
  assert.doesNotMatch(out, /Moving/, out);
  assert.match(out, /Still --> val/);
  assert.match(out, /state Crash \{/);
  assert.match(out, /Crash --> \[\*\]/);
});

test('state: synlig nod som bara fanns i dolda övergångar behålls som deklaration', () => {
  const text = 'stateDiagram-v2\n  A --> B\n  state X {\n    B --> C\n  }';
  const out = filterState(parseState(text), new Set([nodeKey('B')]));
  assert.equal(out, 'stateDiagram-v2\n  A\n  state X {\n    C\n  }');
});

test('state: dold övergång tas bort och dess ändar finns kvar', () => {
  const text = 'stateDiagram-v2\n  A --> B\n  B --> C';
  assert.equal(filterState(parseState(text), new Set([edgeKey('A->B#0')])), 'stateDiagram-v2\n  A\n  B --> C');
});

test('state: dolt sammansatt tillstånd tar bort hela blocket och övergångar till det', () => {
  const out = filterState(parseState(demo), new Set([subgraphKey('Crash')]));
  assert.doesNotMatch(out, /Crash|Larm|Sammanställ|men är bara text/, out);
  assert.match(out, /Still --> Moving : går/);
});

test('state: övergång till dolt sammansatt tillstånd räknas som dold', () => {
  const m = parseState(demo);
  const vis = visibility(m, new Set([subgraphKey('Crash')]));
  assert.equal(vis.isEdgeHidden(m.edges.find(e => e.key === 'Moving->Crash#0')), true);
});

test('state: sammansatt tillstånd vars alla tillstånd är dolda tas bort, även med [*] kvar', () => {
  const text = 'stateDiagram-v2\n  A --> X\n  state X {\n    [*] --> a\n    a --> [*]\n  }';
  const out = filterState(parseState(text), new Set([nodeKey('a')]));
  assert.equal(out, 'stateDiagram-v2\n  A --> X');
});

test('state: dold start tar bara bort [*] i rätt sammansatt tillstånd', () => {
  const out = filterState(parseState(demo), new Set([nodeKey('root_start')]));
  assert.doesNotMatch(out, /^\s*\[\*\] --> Still/m);
  assert.match(out, /\[\*\] --> Larm/);
});

test('state: parallell region som blir tom tar med sig sin avdelare (--)', () => {
  const text = 'stateDiagram-v2\n  state P {\n    a --> b\n    --\n    c\n    --\n    d\n  }';
  const m = parseState(text);
  assert.equal(filterState(m, new Set([nodeKey('c')])), 'stateDiagram-v2\n  state P {\n    a --> b\n    --\n    d\n  }');
  assert.equal(filterState(m, new Set([nodeKey('d')])), 'stateDiagram-v2\n  state P {\n    a --> b\n    --\n    c\n  }');
  assert.equal(filterState(m, new Set([nodeKey('a'), nodeKey('b')])), 'stateDiagram-v2\n  state P {\n    c\n    --\n    d\n  }');
});

test('state: klass och anteckning på tillstånd som inte längre ritas tas bort', () => {
  const text = 'stateDiagram-v2\n  A --> B\n  state X {\n    x\n  }\n  note left of X : text\n  class X,A hot';
  const out = filterState(parseState(text), new Set([nodeKey('x')]));
  assert.equal(out, 'stateDiagram-v2\n  A --> B\n  class A hot');
});

test('diagram: väljer parser och filter efter diagramtyp', () => {
  const { parseDiagram, filterDiagram } = require('../out/diagram');
  const s = parseDiagram('stateDiagram-v2\n  A --> B\n  B --> C');
  assert.equal(s.supported, true);
  assert.equal(filterDiagram(s, new Set([nodeKey('C')])), 'stateDiagram-v2\n  A --> B');
  const f = parseDiagram('flowchart LR\n  A --> B\n  B --> C');
  assert.equal(f.supported, true);
  assert.equal(filterDiagram(f, new Set([nodeKey('C')])), 'flowchart LR\n  A --> B');
  const seq = parseDiagram('sequenceDiagram\n  A->>B: hej\n  B->>C: då');
  assert.equal(seq.supported, true);
  assert.equal(filterDiagram(seq, new Set([nodeKey('C')])), 'sequenceDiagram\n  A->>B: hej');
  const cls = parseDiagram('classDiagram\n  A <|-- B');
  assert.equal(cls.supported, true);
  assert.equal(filterDiagram(cls, new Set([nodeKey('A')])), 'classDiagram\n  class B');
  const other = parseDiagram('erDiagram\n  A ||--o{ B : has');
  assert.equal(other.supported, false);
  assert.equal(other.diagramType, 'erDiagram');
  assert.equal(filterDiagram(other, new Set([nodeKey('A')])), 'erDiagram\n  A ||--o{ B : has');
});

test('state: fokusläge fungerar med grannar via övergångar', () => {
  const m = parseState(demo);
  assert.deepEqual([...neighborhood(m, 'val', 1)].sort(), ['Moving', 'Still', 'val']);
});

test('state: ett tillstånd som också nämns utanför sitt sammansatta tillstånd hör till det sammansatta', () => {
  const m = parseState('stateDiagram-v2\n  W6_F2 --> W7_Wait : trigger\n  state W7 {\n    [*] --> W7_Wait\n  }\n  A --> W7_Wait');
  assert.equal(m.nodes.get('W7_Wait').subgraph, 'W7');
  assert.equal(m.nodes.get('W6_F2').subgraph, undefined);
});

test('state: nämns ett tillstånd i två sammansatta tillstånd hör det till det sista', () => {
  const m = parseState('stateDiagram-v2\n  state V {\n    X --> P\n  }\n  state W {\n    X --> Q\n  }');
  assert.equal(m.nodes.get('X').subgraph, 'W');
});
