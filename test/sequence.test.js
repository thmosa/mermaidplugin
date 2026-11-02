const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSequence, filterSequence, filterSequenceDetailed } = require('../out/sequenceParser');
const { nodeKey, edgeKey, subgraphKey, collapseKey, neighborhood } = require('../out/parser');

const demo = `sequenceDiagram
  title Beställning
  autonumber
  actor U as Användare
  box Aqua Backend
    participant API as API-gateway
    participant DB
  end
  U->>+API: beställ
  API->>DB: spara
  DB-->>API: ok
  loop Var 5:e sekund
    API->>Ext: status
  end
  API-->>-U: kvitto
  Note over API,DB: transaktion
  Note right of U: väntar
  create participant Log
  API->>Log: skriv
  destroy Log
  Log-->>API: klart
  activate DB
  DB->>DB: städa
  deactivate DB`;

test('sequence: känner igen sequenceDiagram men inte andra typer', () => {
  assert.equal(parseSequence(demo).supported, true);
  assert.equal(parseSequence(demo).diagramType, 'sequenceDiagram');
  assert.equal(parseSequence('flowchart LR\n  A --> B').supported, false);
});

test('sequence: deltagare blir noder med alias som etikett och box som grupp', () => {
  const m = parseSequence(demo);
  assert.deepEqual([...m.nodes.keys()], ['U', 'API', 'DB', 'Ext', 'Log']);
  assert.equal(m.nodes.get('U').label, 'Användare');
  assert.equal(m.nodes.get('API').label, 'API-gateway');
  assert.deepEqual([...m.nodes.values()].map(n => n.line), [3, 5, 6, 12, 17]);
  assert.equal(m.nodes.get('API').subgraph, 'box0');
  assert.equal(m.nodes.get('U').subgraph, undefined);
  assert.deepEqual([...m.subgraphs.values()], [{ id: 'box0', title: 'Backend', line: 4, endLine: 7, parent: undefined }]);
});

test('sequence: meddelanden blir kanter med text och rad', () => {
  const m = parseSequence(demo);
  assert.deepEqual(m.edges.map(e => [e.key, e.label, e.line]), [
    ['U->API#0', 'beställ', 8], ['API->DB#0', 'spara', 9], ['DB->API#0', 'ok', 10], ['API->Ext#0', 'status', 12],
    ['API->U#0', 'kvitto', 14], ['API->Log#0', 'skriv', 18], ['Log->API#0', 'klart', 20], ['DB->DB#0', 'städa', 22],
  ]);
});

test('sequence: alla piltyper och meddelanden utan mellanslag', () => {
  const m = parseSequence('sequenceDiagram\n  A->B: 1\n  A-->B: 2\n  A->>B:3\n  A-->>B: 4\n  A-xB: 5\n  A--xB: 6\n  A-)B: 7\n  A--)B: 8\n  A<<->>B: 9\n  A<<-->>B: 10');
  assert.equal(m.edges.length, 10);
  assert.ok(m.edges.every(e => e.from === 'A' && e.to === 'B'));
  assert.equal(m.edges[2].label, '3');
});

test('sequence: box med rgb-färg eller utan färg ger rätt titel', () => {
  const m = parseSequence('sequenceDiagram\n  box rgb(1,2,3) Mitt team\n    participant X\n  end\n  box Grön Team\n    participant Y\n  end\n  box transparent Andra\n    participant Z\n  end');
  assert.deepEqual([...m.subgraphs.values()].map(s => s.title), ['Mitt team', 'Grön Team', 'Andra']);
});

test('sequence: utan något dolt blir texten identisk', () => {
  assert.equal(filterSequence(parseSequence(demo), new Set()), demo);
});

test('sequence: dold deltagare tar bort dess meddelanden, anteckningar och aktiveringar, och numren behålls', () => {
  const out = filterSequence(parseSequence(demo), new Set([nodeKey('DB')]));
  assert.equal(out, `sequenceDiagram
  title Beställning
  autonumber
  actor U as Användare
  box Aqua Backend
    participant API as API-gateway
  end
  U->>+API: beställ
  loop Var 5:e sekund
    autonumber 4
    API->>Ext: status
  end
  API-->>-U: kvitto
  Note over API: transaktion
  Note right of U: väntar
  create participant Log
  API->>Log: skriv
  destroy Log
  Log-->>API: klart`);
});

test('sequence: dolt meddelande med + gör att - på det senare tas bort så att Mermaid inte kraschar', () => {
  const out = filterSequence(parseSequence(demo), new Set([edgeKey('U->API#0')]));
  assert.doesNotMatch(out, /beställ/);
  assert.match(out, /\n  autonumber 2\n  API->>DB: spara/);
  assert.match(out, /\n  API-->>U: kvitto/);
});

test('sequence: dolt skapande meddelande gör create till en vanlig deklaration', () => {
  const out = filterSequence(parseSequence(demo), new Set([edgeKey('API->Log#0')]));
  assert.doesNotMatch(out, /create/);
  assert.match(out, /\n  participant Log\n  destroy Log/);
});

test('sequence: dold deltagare som skapas tar bort create, meddelandet och destroy', () => {
  const out = filterSequence(parseSequence(demo), new Set([nodeKey('Log')]));
  assert.doesNotMatch(out, /Log/);
});

test('sequence: block utan innehåll tas bort, och synlig deltagare utan meddelanden finns kvar', () => {
  const out = filterSequence(parseSequence(demo), new Set([edgeKey('API->Ext#0')]));
  assert.doesNotMatch(out, /loop|status/);
  assert.match(out, /\n  participant Ext\n/);
  assert.match(out, /\n  autonumber 5\n  API-->>-U: kvitto/);
});

test('sequence: dold box döljer sina deltagare och allt som rör dem', () => {
  const out = filterSequence(parseSequence(demo), new Set([subgraphKey('box0')]));
  assert.equal(out, `sequenceDiagram
  title Beställning
  autonumber
  actor U as Användare
  participant Ext
  Note right of U: väntar
  participant Log`);
});

test('sequence: dolt avslutande meddelande tar bort destroy så att Mermaid inte kraschar', () => {
  const out = filterSequence(parseSequence(demo), new Set([edgeKey('Log->API#0')]));
  assert.doesNotMatch(out, /destroy|klart/);
  assert.match(out, /\n  create participant Log\n  API->>Log: skriv\n  activate DB/);
});

// ---------------------------------------------------------------- block

const blocks = `sequenceDiagram
  A->>B: m0
  alt betald
    A->>B: m1
    loop varje sekund
      B->>A: m2
    end
  else obetald
    B->>C: m3
  end
  rect rgb(1,2,3)
    Note over A: n
  end`;

test('sequence: block och deras grenar blir en hierarki med typ, titel och rader, med huvudgrenen som gren 0', () => {
  const m = parseSequence(blocks);
  assert.deepEqual([...m.blocks.values()], [
    { id: 'block0', kind: 'alt', title: 'betald', line: 2, endLine: 9, parent: undefined, section: false },
    { id: 'block0:0', kind: 'alt', title: 'betald', line: 2, endLine: 7, parent: 'block0', section: true },
    { id: 'block1', kind: 'loop', title: 'varje sekund', line: 4, endLine: 6, parent: 'block0:0', section: false },
    { id: 'block0:1', kind: 'else', title: 'obetald', line: 7, endLine: 9, parent: 'block0', section: true },
    { id: 'block2', kind: 'rect', title: 'rgb(1,2,3)', line: 10, endLine: 12, parent: undefined, section: false },
  ]);
});

test('sequence: varje meddelande vet vilket block eller vilken gren det ligger i', () => {
  assert.deepEqual(parseSequence(blocks).edgeParent, [undefined, 'block0:0', 'block1', 'block0:1']);
});

test('sequence: block med bara en gren får ingen gren 0', () => {
  const m = parseSequence('sequenceDiagram\n  loop L\n    A->>B: 1\n  end\n  opt O\n    A->>B: 2\n  end');
  assert.deepEqual([...m.blocks.keys()], ['block0', 'block1']);
  assert.deepEqual(m.edgeParent, ['block0', 'block1']);
});

test('sequence: hopfälld huvudgren behåller blockets rubrik och else-grenen', () => {
  assert.equal(filterSequence(parseSequence(blocks), new Set([collapseKey('block0:0')])), `sequenceDiagram
  A->>B: m0
  alt betald
    Note over A,B: 2 messages hidden
  else obetald
    B->>C: m3
  end
  rect rgb(1,2,3)
    Note over A: n
  end`);
});

test('sequence: box räknas inte som block', () => {
  const m = parseSequence('sequenceDiagram\n  box Team\n    participant X\n  end\n  loop L\n    X->>Y: m\n  end');
  assert.deepEqual([...m.blocks.keys()], ['block0']);
  assert.deepEqual([...m.subgraphs.keys()], ['box0']);
  assert.deepEqual(m.edgeParent, ['block0']);
});

test('sequence: hopfällt block behåller ramen och får en anteckning över de deltagare det rör', () => {
  const out = filterSequence(parseSequence(blocks), new Set([collapseKey('block1')]));
  assert.equal(out, `sequenceDiagram
  A->>B: m0
  alt betald
    A->>B: m1
    loop varje sekund
      Note over A,B: 1 message hidden
    end
  else obetald
    B->>C: m3
  end
  rect rgb(1,2,3)
    Note over A: n
  end`);
});

test('sequence: hopfällt alt tar med alla grenar, och det yttersta hopfällda blocket vinner', () => {
  const want = `sequenceDiagram
  A->>B: m0
  alt betald
    Note over A,C: 3 messages hidden
  end
  rect rgb(1,2,3)
    Note over A: n
  end`;
  assert.equal(filterSequence(parseSequence(blocks), new Set([collapseKey('block0')])), want);
  assert.equal(filterSequence(parseSequence(blocks), new Set([collapseKey('block0'), collapseKey('block1')])), want);
});

test('sequence: hopfällt block utan meddelanden säger bara collapsed', () => {
  const out = filterSequence(parseSequence(blocks), new Set([collapseKey('block2')]));
  assert.match(out, /\n  rect rgb\(1,2,3\)\n    Note over A: collapsed\n  end$/);
});

test('sequence: dolt block försvinner helt, och deltagare som bara fanns där behåller sin livslinje', () => {
  const m = parseSequence(blocks);
  assert.doesNotMatch(filterSequence(m, new Set([subgraphKey('block1')])), /loop|m2/);
  assert.equal(filterSequence(m, new Set([subgraphKey('block0'), collapseKey('block1')])), `sequenceDiagram
  A->>B: m0
  participant C
  rect rgb(1,2,3)
    Note over A: n
  end`);
});

test('sequence: hopfällt block behåller numren efter sig och kraschar inte på - utanför', () => {
  const m = parseSequence('sequenceDiagram\n  autonumber\n  A->>+B: 1\n  loop L\n    B->>C: 2\n    B-->>-A: 3\n  end\n  A->>B: 4');
  assert.equal(filterSequence(m, new Set([collapseKey('block0')])),
    'sequenceDiagram\n  autonumber\n  A->>+B: 1\n  loop L\n    Note over A,C: 2 messages hidden\n  end\n  autonumber 4\n  A->>B: 4');
});

test('sequence: en gren slutar där nästa gren börjar', () => {
  const m = parseSequence('sequenceDiagram\n  alt a\n    A->>B: 1\n  else b\n    A->>B: 2\n  else c\n    A->>B: 3\n  end');
  assert.deepEqual([...m.blocks.values()].map(b => [b.id, b.line, b.endLine]), [['block0', 1, 7], ['block0:0', 1, 3], ['block0:1', 3, 5], ['block0:2', 5, 7]]);
});

test('sequence: hopfälld else behåller sin rubrik och får en anteckning, resten av blocket är kvar', () => {
  assert.equal(filterSequence(parseSequence(blocks), new Set([collapseKey('block0:1')])), `sequenceDiagram
  A->>B: m0
  alt betald
    A->>B: m1
    loop varje sekund
      B->>A: m2
    end
  else obetald
    Note over B,C: 1 message hidden
  end
  rect rgb(1,2,3)
    Note over A: n
  end`);
});

test('sequence: hopfälld gren i mitten påverkar inte grenarna efter, och hopfällt block slår hopfälld gren', () => {
  const m = parseSequence('sequenceDiagram\n  alt a\n    A->>B: 1\n  else b\n    A->>C: 2\n    C->>A: 3\n  else c\n    B->>A: 4\n  end');
  assert.equal(filterSequence(m, new Set([collapseKey('block0:1')])),
    'sequenceDiagram\n  alt a\n    A->>B: 1\n  else b\n    Note over A,C: 2 messages hidden\n  else c\n    B->>A: 4\n  end');
  assert.equal(filterSequence(m, new Set([collapseKey('block0:1'), collapseKey('block0')])),
    'sequenceDiagram\n  alt a\n    Note over A,C: 4 messages hidden\n  end');
});

test('sequence: en gren utan innehåll kvar tas bort, eftersom en tom sista gren hamnar utanför ramen', () => {
  const out = filterSequence(parseSequence(blocks), new Set([edgeKey('B->C#0')]));
  assert.doesNotMatch(out, /else|m3/);
  assert.match(out, /\n    end\n  end\n/);
});

test('sequence: autonumber inne i ett hopfällt block ligger kvar så att numreringen efter stämmer', () => {
  const m = parseSequence('sequenceDiagram\n  autonumber\n  A->>B: 1\n  loop L\n    autonumber off\n    A->>B: x\n  end\n  A->>B: 2');
  assert.equal(filterSequence(m, new Set([collapseKey('block0')])),
    'sequenceDiagram\n  autonumber\n  A->>B: 1\n  loop L\n    Note over A,B: 1 message hidden\n    autonumber off\n  end\n  A->>B: 2');
});

test('sequence: ritade block i SVG-ordning, block när de stängs och rect omvänt', () => {
  const m = parseSequence(blocks);
  assert.deepEqual(filterSequenceDetailed(m, new Set()), { text: blocks, blocks: ['block1', 'block0'], rects: ['block2'], sections: { block0: ['block0:1'] } });
  // Tomma grenar ritas inte, så rubrikerna i SVG:n är bara de som finns kvar.
  const three = parseSequence('sequenceDiagram\n  alt a\n    A->>B: 1\n  else b\n    A->>C: 2\n  else c\n    B->>A: 3\n  end');
  assert.deepEqual(filterSequenceDetailed(three, new Set([nodeKey('C')])).sections, { block0: ['block0:2'] });
  assert.deepEqual(filterSequenceDetailed(m, new Set([collapseKey('block0')])).blocks, ['block0']);
  assert.deepEqual(filterSequenceDetailed(m, new Set([subgraphKey('block1')])).blocks, ['block0']);
  const r = parseSequence('sequenceDiagram\n  rect red\n    A->>B: 1\n    rect blue\n      A->>B: 2\n    end\n  end\n  rect green\n    A->>B: 3\n  end');
  assert.deepEqual(filterSequenceDetailed(r, new Set()).rects, ['block2', 'block0', 'block1']);
});

test('sequence: fokusläge använder meddelanden som grannar', () => {
  assert.deepEqual([...neighborhood(parseSequence(demo), 'U', 1)].sort(), ['API', 'U']);
});
