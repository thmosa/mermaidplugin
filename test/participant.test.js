// "Change Participant": högerklick på en deltagare i ett meddelande i ett sequence diagram byter
// just den förekomsten mot en annan befintlig deltagare (till skillnad från Rename som byter alla).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { participantAt, participantChoices } = require('../out/participant');
const { parseDiagram } = require('../out/diagram');

const TEXT = [
  'sequenceDiagram',
  '  actor U as Användare',
  '  participant API as API-gateway',
  '  participant Order',
  '  U->>+API: Lägg order API',
  '  API->>Order: skapa(order)',
  '  Note over API,Order: U väntar',
  '  activate Order',
].join('\n');
const model = parseDiagram(TEXT);

test('deltagare: markören på avsändare eller mottagare i ett meddelande ger just den förekomsten', () => {
  assert.deepEqual(participantAt(TEXT, model, 4, 3), { id: 'U', line: 4, start: 2, end: 3 });
  assert.deepEqual(participantAt(TEXT, model, 4, 9), { id: 'API', line: 4, start: 7, end: 10 });
  assert.deepEqual(participantAt(TEXT, model, 5, 10), { id: 'Order', line: 5, start: 8, end: 13 });
});

test('deltagare: i anteckningar och activate går det också', () => {
  assert.equal(participantAt(TEXT, model, 6, 16).id, 'Order');
  assert.equal(participantAt(TEXT, model, 7, 12).id, 'Order');
});

test('deltagare: meddelandetexten och deklarationen räknas inte', () => {
  // "API" i meddelandetexten är bara text.
  assert.equal(participantAt(TEXT, model, 4, 25), undefined);
  assert.equal(participantAt(TEXT, model, 6, 24), undefined);
  // Deklarationen byter man med Rename.
  assert.equal(participantAt(TEXT, model, 2, 15), undefined);
  assert.equal(participantAt(TEXT, model, 1, 9), undefined);
});

test('deltagare: den skapade eller förstörda deltagaren i sitt create- eller destroy-meddelande går inte att byta', () => {
  const text = 'sequenceDiagram\n  participant A\n  create participant M\n  A->>M: hej\n  destroy M\n  M-->>A: hejdå';
  const m = parseDiagram(text);
  assert.match(participantAt(text, m, 3, 6).blocked, /create/);
  assert.match(participantAt(text, m, 5, 2).blocked, /destroy/);
  // Den andra änden går bra.
  assert.equal(participantAt(text, m, 3, 2).blocked, undefined);
  assert.equal(participantAt(text, m, 5, 8).blocked, undefined);
});

test('deltagare: bara i sequence diagram', () => {
  const flow = 'flowchart LR\n  A --> B';
  assert.equal(participantAt(flow, parseDiagram(flow), 1, 2), undefined);
});

test('deltagare: valen är de andra deltagarna i ordning, med namnet som visas', () => {
  assert.deepEqual(participantChoices(model, 'API'), [{ id: 'U', label: 'Användare' }, { id: 'Order', label: 'Order' }]);
});

test('deltagare: "Change Participant" finns i editorns högerklicksmeny för sequence diagram', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const cmd = pkg.contributes.commands.find(c => c.command === 'mermaidTree.changeParticipant');
  assert.equal(cmd?.title, 'Change Participant…');
  const ctx = pkg.contributes.menus['editor/context'].find(m => m.command === 'mermaidTree.changeParticipant');
  assert.match(ctx.when, /resourceLangId == mermaid/);
  assert.match(ctx.when, /mermaidTree\.sequence/);
  const palette = pkg.contributes.menus.commandPalette.find(m => m.command === 'mermaidTree.changeParticipant');
  assert.match(palette.when, /mermaidTree\.sequence/);
});
