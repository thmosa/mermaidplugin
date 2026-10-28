const test = require('node:test');
const assert = require('node:assert/strict');
const { children, parentOf, initialState } = require('../out/tree');
const { parseDiagram } = require('../out/diagram');

const show = items => items.map(i => i.kind === 'edge' ? `edge:${i.key}` : i.kind === 'edgeGroup' || i.kind === 'info' ? i.kind : `${i.kind}:${i.id}`);

const state = parseDiagram(`stateDiagram-v2
  [*] --> Idle
  Idle --> Busy
  state Busy {
    [*] --> Work
    state Inner {
      deep
    }
  }
  state Fail {
    x
  }
  Busy --> Done`);

test('träd: översta nivån har sammansatta tillstånd i radordning, sedan tillstånd utan förälder, sist övergångarna', () => {
  assert.deepEqual(show(children(state)), ['subgraph:Busy', 'subgraph:Fail', 'node:root_start', 'node:Idle', 'node:Done', 'edgeGroup']);
});

test('träd: ett sammansatt tillstånd innehåller sina nästlade grupper och sina tillstånd', () => {
  assert.deepEqual(show(children(state, { kind: 'subgraph', id: 'Busy' })), ['subgraph:Inner', 'node:Busy_start', 'node:Work']);
  assert.deepEqual(show(children(state, { kind: 'subgraph', id: 'Inner' })), ['node:deep']);
});

test('träd: övergångsgruppen innehåller alla övergångar, och tillstånd har inga barn', () => {
  assert.deepEqual(show(children(state, { kind: 'edgeGroup' })),
    ['edge:root_start->Idle#0', 'edge:Idle->Busy#0', 'edge:Busy_start->Work#0', 'edge:Busy->Done#0']);
  assert.deepEqual(children(state, { kind: 'node', id: 'Idle' }), []);
});

test('träd: utan kanter blir det ingen övergångsgrupp', () => {
  assert.deepEqual(show(children(parseDiagram('flowchart LR\n  A\n  B'))), ['node:A', 'node:B']);
});

test('träd: diagramtyp som inte stöds ger en informationsrad', () => {
  const items = children(parseDiagram('sequenceDiagram\n  A->>B: hi'));
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'info');
  assert.match(items[0].text, /sequenceDiagram/);
});

test('träd: förälder är närmaste sammansatta tillstånd, gruppen för kanter, eller ingen', () => {
  assert.deepEqual(parentOf(state, { kind: 'node', id: 'deep' }), { kind: 'subgraph', id: 'Inner' });
  assert.deepEqual(parentOf(state, { kind: 'subgraph', id: 'Inner' }), { kind: 'subgraph', id: 'Busy' });
  assert.deepEqual(parentOf(state, { kind: 'edge', key: 'Idle->Busy#0' }), { kind: 'edgeGroup' });
  assert.equal(parentOf(state, { kind: 'node', id: 'Idle' }), undefined);
  assert.equal(parentOf(state, { kind: 'subgraph', id: 'Busy' }), undefined);
});

test('träd: grupper börjar hopfällda, tillstånd och kanter går inte att fälla ut', () => {
  assert.equal(initialState({ kind: 'subgraph', id: 'Busy' }), 'collapsed');
  assert.equal(initialState({ kind: 'edgeGroup' }), 'collapsed');
  assert.equal(initialState({ kind: 'node', id: 'Idle' }), 'none');
  assert.equal(initialState({ kind: 'edge', key: 'Idle->Busy#0' }), 'none');
});
