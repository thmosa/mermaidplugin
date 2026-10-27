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
