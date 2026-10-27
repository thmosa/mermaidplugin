const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFlowchart, filterFlowchart, neighborhood } = require('../out/parser');

const demo = `---
config:
  layout: elk
---
flowchart LR
  %% kommentar
  subgraph backend [Backend]
    direction TB
    api[API-gateway] --> auth(Auth)
    api -->|loggar| log[(Loggtjänst)]
  end
  subgraph Frontend app
    web>Webb] & mobile{{Mobil}} --> api
  end
  auth -- token --> web
  log -.-> auth
  style log fill:#f99
  class api,auth important
  linkStyle 0,4 stroke:red`;

test('tolkar noder, kanter och subgrafer', () => {
  const m = parseFlowchart(demo);
  assert.equal(m.supported, true);
  assert.deepEqual([...m.nodes.keys()].sort(), ['api', 'auth', 'log', 'mobile', 'web']);
  assert.equal(m.nodes.get('api').label, 'API-gateway');
  assert.equal(m.nodes.get('log').label, 'Loggtjänst');
  assert.equal(m.nodes.get('web').label, 'Webb');
  assert.equal(m.nodes.get('api').subgraph, 'backend');
  assert.equal(m.nodes.get('web').subgraph, 'subGraph1');
  assert.deepEqual(m.edges.map(e => `${e.from}->${e.to}`), ['api->auth', 'api->log', 'web->api', 'mobile->api', 'auth->web', 'log->auth']);
  assert.equal(m.edges[1].label, 'loggar');
  assert.equal(m.edges[4].label, 'token');
  assert.deepEqual([...m.subgraphs.keys()].sort(), ['backend', 'subGraph1']);
  assert.equal(m.subgraphs.get('subGraph1').title, 'Frontend app');
});

test('utan dolda element blir texten oförändrad', () => {
  const m = parseFlowchart(demo);
  assert.equal(filterFlowchart(m, new Set()), demo);
});

test('dold nod tar bort kanter, style och class-referenser', () => {
  const m = parseFlowchart(demo);
  const out = filterFlowchart(m, new Set(['n:log']));
  assert.doesNotMatch(out, /log\b(?!g)/);
  assert.match(out, /api\[API-gateway\] --> auth\(Auth\)/);
  assert.doesNotMatch(out, /style log/);
  // Kant 4 (auth->web) får nytt nummer 3 eftersom kant 1 försvann.
  assert.match(out, /linkStyle 0,3 stroke:red/);
});

test('dold kant behåller nodernas former', () => {
  const m = parseFlowchart(demo);
  const out = filterFlowchart(m, new Set(['e:api->auth#0']));
  assert.match(out, /^\s+api\[API-gateway\]$/m);
  assert.match(out, /^\s+auth\(Auth\)$/m);
});

test('dold subgraf döljer allt innehåll', () => {
  const m = parseFlowchart(demo);
  const out = filterFlowchart(m, new Set(['s:subGraph1']));
  assert.doesNotMatch(out, /Frontend|web|mobile/);
  assert.match(out, /subgraph backend/);
  assert.equal((out.match(/^\s*end$/gm) || []).length, 1);
});

test('subgraf där alla noder är dolda försvinner', () => {
  const m = parseFlowchart(demo);
  const out = filterFlowchart(m, new Set(['n:web', 'n:mobile']));
  assert.doesNotMatch(out, /subgraph Frontend app/);
  assert.equal((out.match(/^\s*end$/gm) || []).length, 1);
});

test('kedjor och semikolon', () => {
  const m = parseFlowchart('graph TD\nA --> B --> C; C ==> D');
  assert.deepEqual(m.edges.map(e => `${e.from}->${e.to}`), ['A->B', 'B->C', 'C->D']);
  const out = filterFlowchart(m, new Set(['n:B']));
  assert.match(out, /C ==> D/);
  assert.doesNotMatch(out, /\bB\b/);
});

test('olika länktyper', () => {
  const m = parseFlowchart('flowchart TD\nA --- B\nB -.- C\nC ~~~ D\nD <--> E\nE --o F\nF == text ==> G\nG -. t .-> H\nH e1@--> I');
  assert.equal(m.edges.length, 8);
  assert.equal(m.edges[5].label, 'text');
});

test('grannskap', () => {
  const m = parseFlowchart(demo);
  assert.deepEqual([...neighborhood(m, 'log', 1)].sort(), ['api', 'auth', 'log']);
});

test('andra diagramtyper markeras som ej stödda', () => {
  const m = parseFlowchart('sequenceDiagram\nA->>B: hej');
  assert.equal(m.supported, false);
  assert.equal(filterFlowchart(m, new Set(['n:A'])), 'sequenceDiagram\nA->>B: hej');
});

// ---------------------------------------------------------------- kända luckor

const edgeList = m => m.edges.map(e => `${e.from}->${e.to}`);

test('länkar utan mellanslag', () => {
  const m = parseFlowchart('flowchart LR\nA-->B\nB---C\nC-.->D\nD==>E\nE-->|ja|F\nF-- text -->G\nG-->H-->I');
  assert.deepEqual(edgeList(m), ['A->B', 'B->C', 'C->D', 'D->E', 'E->F', 'F->G', 'G->H', 'H->I']);
  assert.equal(m.edges[4].label, 'ja');
  assert.equal(m.edges[5].label, 'text');
});

test('id med bindestreck följt av länk utan mellanslag', () => {
  const m = parseFlowchart('flowchart LR\nmy-node-->other-node');
  assert.deepEqual(edgeList(m), ['my-node->other-node']);
});

test('semikolon inuti citattecken och kantetiketter delar inte satsen', () => {
  const m = parseFlowchart('flowchart LR\nA["a;b"] --> B\nB -->|x;y| C; C --> D');
  assert.deepEqual(edgeList(m), ['A->B', 'B->C', 'C->D']);
  assert.equal(m.nodes.get('A').label, 'a;b');
  assert.equal(m.edges[1].label, 'x;y');
});

test('markdown-sträng: etiketten visas utan formateringstecken', () => {
  const m = parseFlowchart('flowchart LR\nA["`**Fet** och _kursiv_`"] --> B');
  assert.equal(m.nodes.get('A').label, 'Fet och kursiv');
});

test('markdown-sträng över flera rader blir en nod', () => {
  const src = 'flowchart LR\nA["`Rad ett\nRad två`"] --> B\nB --> C';
  const m = parseFlowchart(src);
  assert.deepEqual([...m.nodes.keys()], ['A', 'B', 'C']);
  assert.equal(m.nodes.get('A').label, 'Rad ett Rad två');
  assert.deepEqual(edgeList(m), ['A->B', 'B->C']);
  assert.equal(m.edges[1].line, 3);
  assert.equal(filterFlowchart(m, new Set()), src);
  assert.match(filterFlowchart(m, new Set(['n:C'])), /A\["`Rad ett\nRad två`"\] --> B/);
});

test('subgraf-titel som markdown-sträng', () => {
  const m = parseFlowchart('flowchart LR\nsubgraph s ["`**Backend**`"]\n  A\nend');
  assert.equal(m.subgraphs.get('s').title, 'Backend');
});

test('kommentar i radslut tolkas inte, eftersom Mermaid 12 ger syntaxfel', () => {
  // Kontrollerat mot Mermaid 12.1: "A --> B %% x" ger Parse error. Raden lämnas orörd
  // så att förhandsvisningen visar samma fel som Mermaid, även när andra element döljs.
  const m = parseFlowchart('flowchart LR\nA --> B %% förklaring\nB --> C');
  assert.deepEqual(edgeList(m), ['B->C']);
  assert.match(filterFlowchart(m, new Set(['n:C'])), /A --> B %% förklaring/);
  assert.match(filterFlowchart(m, new Set(['n:B'])), /A --> B %% förklaring/);
});

test('%% inuti citattecken är ingen kommentar', () => {
  const m = parseFlowchart('flowchart LR\nA["50%% rabatt"] --> B');
  assert.deepEqual(edgeList(m), ['A->B']);
  assert.equal(m.nodes.get('A').label, '50%% rabatt');
});
