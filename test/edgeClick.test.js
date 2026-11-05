// Klick på en pils text i förhandsvisningen: vilken kant i koden är det?
// Förhandsvisningen skickar texten och vilken i ordningen bland ritade texter med samma lydelse den var.
const test = require('node:test');
const assert = require('node:assert/strict');
const { edgeAtLabel, edgeAtClick, labelText } = require('../out/edgeClick');
const { parseDiagram } = require('../out/diagram');
const { edgeKey, nodeKey, collapseKey, subgraphKey } = require('../out/parser');

const keyOf = e => e && e.key;

test('pilens text: hittar kanten med samma text i flowchart, state, class och sequence', () => {
  const flow = parseDiagram('flowchart LR\n  A -->|go| B\n  B -- stop --> C');
  assert.equal(keyOf(edgeAtLabel(flow, new Set(), 'stop', 0)), 'B->C#0');
  const state = parseDiagram('stateDiagram-v2\n  [*] --> A\n  A --> B : go');
  assert.equal(keyOf(edgeAtLabel(state, new Set(), 'go', 0)), 'A->B#0');
  const cls = parseDiagram('classDiagram\n  A --> B : uses\n  B --> C : has');
  assert.equal(keyOf(edgeAtLabel(cls, new Set(), 'has', 0)), 'B->C#0');
  const seq = parseDiagram('sequenceDiagram\n  A->>B: hello\n  B-->>A: hi');
  assert.equal(keyOf(edgeAtLabel(seq, new Set(), 'hi', 0)), 'B->A#0');
});

test('pilens text: samma text flera gånger väljs efter ordningen bland de ritade', () => {
  const m = parseDiagram('stateDiagram-v2\n  A --> B : retry\n  B --> C : retry\n  C --> A : retry');
  assert.equal(keyOf(edgeAtLabel(m, new Set(), 'retry', 1)), 'B->C#0');
  // B är dold, så den andra ritade "retry" är C --> A.
  assert.equal(keyOf(edgeAtLabel(m, new Set([nodeKey('B')]), 'retry', 1)), 'C->A#0');
  assert.equal(keyOf(edgeAtLabel(m, new Set([edgeKey('A->B#0')]), 'retry', 0)), 'B->C#0');
});

test('pilens text: kanter inne i en hopfälld grupp ritas inte och räknas inte', () => {
  const m = parseDiagram('flowchart TD\n  subgraph G\n    A -->|x| B\n  end\n  B -->|x| C');
  assert.equal(keyOf(edgeAtLabel(m, new Set([collapseKey('G')]), 'x', 0)), 'B->C#0');
});

test('pilens text: meddelanden i ett hopfällt eller dolt block räknas inte', () => {
  const m = parseDiagram('sequenceDiagram\n  loop L\n    A->>B: ping\n  end\n  A->>B: ping');
  const block = [...m.blocks.keys()][0];
  assert.equal(edgeAtLabel(m, new Set(), 'ping', 1).line, 4);
  assert.equal(edgeAtLabel(m, new Set([collapseKey(block)]), 'ping', 0).line, 4);
  assert.equal(edgeAtLabel(m, new Set([subgraphKey(block)]), 'ping', 0).line, 4);
});

test('pilens text: radbrytningar och mellanrum jämförs som i det ritade', () => {
  const m = parseDiagram('stateDiagram-v2\n  A --> B : first<br/>second   part');
  assert.equal(keyOf(edgeAtLabel(m, new Set(), 'first second part', 0)), 'A->B#0');
  assert.equal(labelText('a<br>b <br />c\n d'), 'a b c d');
  // Markdown-sträng ritas utan fetstil- och kursivtecken.
  assert.equal(labelText('`**yes** sir _now_`'), 'yes sir now');
});

test('klick: förhandsvisningen skickar alla ritade texter och vilken som klickades', () => {
  const m = parseDiagram('stateDiagram-v2\n  A --> B : retry\n  B --> C : go\n  C --> A : retry');
  assert.equal(keyOf(edgeAtClick(m, new Set(), ['retry', 'go', 'retry'], 2)), 'C->A#0');
  assert.equal(keyOf(edgeAtClick(m, new Set(), ['retry', 'go', 'retry'], 1)), 'B->C#0');
});

test('klick: sequence ritar varje rad i ett meddelande som en egen text', () => {
  const m = parseDiagram('sequenceDiagram\n  A->>B: hello<br/>world\n  B-->>A: hello\n  A->>B: hi');
  const texts = ['hello', 'world', 'hello', 'hi'];
  assert.equal(edgeAtClick(m, new Set(), texts, 1).line, 1);
  assert.equal(edgeAtClick(m, new Set(), texts, 2).line, 2);
  assert.equal(edgeAtClick(m, new Set(), texts, 3).line, 3);
  // Det dolda första meddelandet ritas inte.
  assert.equal(edgeAtClick(m, new Set([edgeKey('A->B#0')]), ['hello', 'hi'], 1).line, 3);
});

test('pilens text: okänd text eller för högt nummer ger ingen eller den sista', () => {
  const m = parseDiagram('flowchart LR\n  A -->|go| B');
  assert.equal(edgeAtLabel(m, new Set(), 'nope', 0), undefined);
  assert.equal(keyOf(edgeAtLabel(m, new Set(), 'go', 5)), 'A->B#0');
});
