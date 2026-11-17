const test = require('node:test');
const assert = require('node:assert/strict');
const { caseConflicts } = require('../out/diagnostics');
const { parseDiagram } = require('../out/diagram');

const find = text => caseConflicts(text, parseDiagram(text));
const at = (text, d) => text.split('\n')[d.line].slice(d.start, d.end);

test('versaler: inga varningar när alla id:n är unika oavsett skiftläge', () => {
  assert.deepEqual(find('flowchart LR\n  A --> B\n  B --> C'), []);
});

test('versaler: id:n som bara skiljer i skiftläge markeras där de används', () => {
  const text = 'stateDiagram-v2\n  [*] --> Still\n  Still --> Moving\n  still --> Moving';
  const d = find(text);
  assert.deepEqual(d.map(x => [x.line, at(text, x)]), [[1, 'Still'], [2, 'Still'], [3, 'still']]);
  assert.match(d[0].message, /Still/);
  assert.match(d[0].message, /still/);
  assert.equal(d[0].message, '"Still" differs only in letter case from "still". Mermaid treats them as different.');
  assert.deepEqual(d[2].similar, ['Still']);
});

test('versaler: träffar bara hela id:t, inte delar av längre namn eller text i citat och etiketter', () => {
  const text = 'flowchart LR\n  a["A och a"] --> A\n  aa --> A\n  A -->|a| B';
  const d = find(text);
  assert.deepEqual(d.map(x => [x.line, x.start, at(text, x)]), [[1, 2, 'a'], [1, 19, 'A'], [2, 9, 'A'], [3, 2, 'A']]);
});

test('versaler: sammansatt tillstånd och tillstånd räknas mot varandra', () => {
  const text = 'stateDiagram-v2\n  state Crash {\n    a\n  }\n  crash --> Crash';
  const d = find(text);
  assert.deepEqual(d.map(x => [x.line, at(text, x)]), [[1, 'Crash'], [4, 'crash'], [4, 'Crash']]);
});

test('versaler: start- och slutpunkter ([*]) ingår inte', () => {
  const text = 'stateDiagram-v2\n  [*] --> Root_start\n  root_start2 --> [*]';
  assert.deepEqual(find(text), []);
});

test('versaler: diagramtyper som inte stöds ger inga varningar', () => {
  assert.deepEqual(find('erDiagram\n  A ||--o{ a : has'), []);
});

test('versaler: class markerar klasser men inte ord i relationsetiketter eller medlemsrader', () => {
  const text = 'classDiagram\n  class Order\n  Kund --> order : Order skapas\n  Kund : +Order senaste';
  assert.deepEqual(find(text).map(x => [x.line, at(text, x)]), [[1, 'Order'], [2, 'order']]);
});

test('versaler: sequence markerar deltagare men inte ord i meddelandetexten', () => {
  const text = 'sequenceDiagram\n  Order->>DB: Order sparas\n  order->>DB: order';
  assert.deepEqual(find(text).map(x => [x.line, at(text, x)]), [[1, 'Order'], [2, 'order']]);
});

// ------------------------------------------------------------ snabbfix: använd det andra namnet

const { caseFixChoices } = require('../out/diagnostics');

test('skiftläge: snabbfixen erbjuder de andra stavningarna, och den som följer namnstilen är förvald', () => {
  const text = 'stateDiagram-v2\n  Jaspel --> Pelmora\n  jaspel --> Pelmora';
  const [lower] = find(text).filter(c => c.id === 'jaspel');
  assert.deepEqual(caseFixChoices(lower, 'PascalCase'), [{ name: 'Jaspel', preferred: true }]);
  assert.deepEqual(caseFixChoices(lower, 'camelCase'), [{ name: 'Jaspel', preferred: false }]);
  const [upper] = find(text).filter(c => c.id === 'Jaspel');
  assert.deepEqual(caseFixChoices(upper, 'camelCase'), [{ name: 'jaspel', preferred: true }]);
  assert.deepEqual(caseFixChoices(upper, 'off'), [{ name: 'jaspel', preferred: false }]);
});

test('skiftläge: med flera stavningar kommer den som följer stilen först', () => {
  const text = 'flowchart LR\n  orderLine --> a\n  ORDERLINE --> a\n  OrderLine --> a';
  const [c] = find(text).filter(c => c.id === 'ORDERLINE');
  assert.deepEqual(caseFixChoices(c, 'PascalCase').map(x => x.name), ['OrderLine', 'orderLine']);
  assert.equal(caseFixChoices(c, 'PascalCase')[0].preferred, true);
});
