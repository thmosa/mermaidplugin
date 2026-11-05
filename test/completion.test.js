// Förslag på deltagare när man skriver i ett sequence diagram: i början av ett meddelande, efter
// pilen, i anteckningar och efter activate/deactivate/destroy. Inte i meddelandetexten.
const test = require('node:test');
const assert = require('node:assert/strict');
const { participantCompletion } = require('../out/participant');
const { parseDiagram } = require('../out/diagram');

const HEAD = [
  'sequenceDiagram',
  '  actor U as Användare',
  '  participant API as API-gateway',
  '  participant Order',
  '  U->>API: hej',
];

/** Förslagen när markören står där | är i raden som läggs till sist. */
function at(lineWithCursor) {
  const col = lineWithCursor.indexOf('|');
  const lines = [...HEAD, lineWithCursor.replace('|', '')];
  const text = lines.join('\n');
  return participantCompletion(text, parseDiagram(text), lines.length - 1, col);
}
const ids = r => r && r.items.map(i => i.id);

test('förslag: i början av en rad och efter pilen', () => {
  assert.deepEqual(ids(at('  |')), ['U', 'API', 'Order']);
  assert.deepEqual(ids(at('  API->>|')), ['U', 'API', 'Order']);
  assert.deepEqual(ids(at('  API-->>+|')), ['U', 'API', 'Order']);
  assert.deepEqual(ids(at('  API --x |')), ['U', 'API', 'Order']);
});

test('förslag: det påbörjade ordet ersätts, och visningsnamnet följer med', () => {
  const r = at('  API->>Ord|');
  assert.equal(r.start, 8);
  assert.deepEqual(r.items.find(i => i.id === 'API'), { id: 'API', label: 'API-gateway' });
  assert.equal(at('  Or|').start, 2);
});

test('förslag: i anteckningar, också efter kommatecken, och efter activate, deactivate och destroy', () => {
  assert.ok(ids(at('  Note over |')));
  assert.ok(ids(at('  Note over API,|')));
  assert.ok(ids(at('  note left of |')));
  assert.ok(ids(at('  Note right of Or|')));
  assert.ok(ids(at('  activate |')));
  assert.ok(ids(at('  deactivate A|')));
  assert.ok(ids(at('  destroy |')));
});

test('förslag: inte i meddelandetexten, anteckningstexten, deklarationer eller blockens titlar', () => {
  assert.equal(at('  U->>API: |'), undefined);
  assert.equal(at('  U->>API: hej A|'), undefined);
  assert.equal(at('  Note over API: |'), undefined);
  assert.equal(at('  participant |'), undefined);
  assert.equal(at('  loop |'), undefined);
  assert.equal(at('  alt kort|'), undefined);
});

test('förslag: bara i sequence diagram', () => {
  const text = 'flowchart LR\n  A --> B\n  ';
  assert.equal(participantCompletion(text, parseDiagram(text), 2, 2), undefined);
});
