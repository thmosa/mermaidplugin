const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFlowchart, filterFlowchart, collapseKey, nodeKey, subgraphKey, visibility } = require('../out/parser');
const { parseState, filterState } = require('../out/stateParser');

// Hopfällning: en subgraf eller ett sammansatt tillstånd ritas som en enda ruta.
// Den lagras i samma mängd som dolda element, med nyckeln c:<id>.

const flow = `flowchart LR
  user((User))
  subgraph backend [Backend]
    gw[Gateway] --> auth(Auth)
    gw --> db[(DB)]
  end
  user --> gw
  user -.-> auth
  auth --> ext[External]
  style auth fill:#f00
  linkStyle 3 stroke:red`;

test('hopfällning flowchart: gruppen blir en ruta, kanter dras om till den och dubbletter tas bort', () => {
  const out = filterFlowchart(parseFlowchart(flow), new Set([collapseKey('backend')]));
  assert.equal(out, `flowchart LR
  user((User))
  backend[["Backend (+3)"]]
  user --> backend
  backend --> ext[External]`);
});

test('hopfällning flowchart: linkStyle räknas om efter de kanter som finns kvar', () => {
  const text = 'flowchart LR\n  subgraph s\n    a --> b\n  end\n  x --> a\n  b --> y\n  linkStyle 2 stroke:red';
  const out = filterFlowchart(parseFlowchart(text), new Set([collapseKey('s')]));
  assert.equal(out, 'flowchart LR\n  s[["s (+2)"]]\n  x --> s\n  s --> y\n  linkStyle 1 stroke:red');
});

test('hopfällning flowchart: dold slår hopfälld, och yttre hopfällning slår inre', () => {
  const text = 'flowchart LR\n  subgraph outer\n    subgraph inner\n      a\n    end\n    b\n  end\n  b --> c';
  const m = parseFlowchart(text);
  assert.equal(filterFlowchart(m, new Set([collapseKey('outer'), subgraphKey('outer')])), 'flowchart LR\n  c');
  assert.equal(filterFlowchart(m, new Set([collapseKey('outer'), collapseKey('inner')])), 'flowchart LR\n  outer[["outer (+2)"]]\n  outer --> c');
  assert.equal(filterFlowchart(m, new Set([collapseKey('inner')])),
    'flowchart LR\n  subgraph outer\n    inner[["inner (+1)"]]\n    b\n  end\n  b --> c');
});

test('hopfällning flowchart: dolda noder i gruppen räknas inte och deras kanter dras inte om', () => {
  const out = filterFlowchart(parseFlowchart(flow), new Set([collapseKey('backend'), nodeKey('auth')]));
  assert.equal(out, `flowchart LR
  user((User))
  backend[["Backend (+2)"]]
  user --> backend
  ext[External]`);
});

test('hopfällning flowchart: citattecken i titeln förstör inte rutan', () => {
  const text = 'flowchart LR\n  subgraph s ["Säg \\"hej\\""]\n    a\n  end';
  const out = filterFlowchart(parseFlowchart(text), new Set([collapseKey('s')]));
  assert.doesNotMatch(out.split('\n')[1].slice(6, -3), /"/);
});

test('hopfällning: c:-nycklar påverkar inte vad som räknas som dolt', () => {
  const m = parseFlowchart(flow);
  const vis = visibility(m, new Set([collapseKey('backend')]));
  assert.equal(vis.isNodeHidden('gw'), false);
  assert.equal(vis.isSubgraphHidden('backend'), false);
});

const state = `stateDiagram-v2
  [*] --> Idle
  Idle --> Work : start
  state Work {
    [*] --> Read
    Read --> Parse
    Parse --> [*]
  }
  Idle --> Parse : skip
  Work --> Done
  Parse --> Done
  note right of Read : inside
  class Read hot`;

test('hopfällning state: sammansatt tillstånd blir ett tillstånd, övergångar dras om och dubbletter tas bort', () => {
  const out = filterState(parseState(state), new Set([collapseKey('Work')]));
  assert.equal(out, `stateDiagram-v2
  [*] --> Idle
  Idle --> Work : start
  state "Work (+2)" as Work
  Work --> Done`);
});

test('hopfällning state: övergång från [*] utanför till ett inre tillstånd behåller [*]', () => {
  const text = 'stateDiagram-v2\n  state G {\n    a --> b\n  }\n  [*] --> a';
  assert.equal(filterState(parseState(text), new Set([collapseKey('G')])), 'stateDiagram-v2\n  state "G (+2)" as G\n  [*] --> G');
});

test('hopfällning state: hopfällt tillstånd i en parallell region räknas som innehåll', () => {
  const text = 'stateDiagram-v2\n  state P {\n    state G {\n      a\n    }\n    --\n    c\n  }';
  assert.equal(filterState(parseState(text), new Set([collapseKey('G')])),
    'stateDiagram-v2\n  state P {\n    state "G (+1)" as G\n    --\n    c\n  }');
});
