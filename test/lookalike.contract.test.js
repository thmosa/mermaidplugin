// Kontrakt för varningen om tecken som ser likadana ut: riktiga Mermaid ritar "Оrder" (kyrilliskt О)
// och "Order" som två olika saker, och efter rättningen blir de en.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openMermaid } = require('./support/mermaid-browser');
const { lookalikeIssues } = require('../out/lookalike');
const { parseDiagram } = require('../out/diagram');

let mm;
test.before(async () => { mm = await openMermaid({ pages: 2 }); });
test.after(async () => { await mm?.close(); });

const O = 'О';      // kyrilliskt О
const WIDE_O = 'Ｏ'; // brett Ｏ

/** Byter varje användning av det första namnet som varnas mot förslaget. */
function fix(text) {
  const [issue] = lookalikeIssues(text, parseDiagram(text));
  assert.ok(issue?.fixable, 'en rättning ska finnas');
  const lines = text.split('\n');
  for (const r of [...issue.ranges].reverse()) lines[r.line] = lines[r.line].slice(0, r.start) + issue.suggestion + lines[r.line].slice(r.end);
  return lines.join('\n');
}

/** Namnen Mermaid ritar: noder, tillstånd, klasser eller deltagare. */
const drawn = r => (r.seq?.actors.length ? r.seq.actors : r.nodes.map(n => n.id)).filter(id => !/_start$|_end$|^root_/.test(id)).sort();

const CASES = {
  flowchart: `flowchart LR\n  Order --> Kund\n  Kund --> ${O}rder`,
  state: `stateDiagram-v2\n  [*] --> Order\n  Order --> Kund\n  Kund --> ${O}rder`,
  sequence: `sequenceDiagram\n  participant Order\n  Kund->>Order: köp\n  ${O}rder->>Kund: kvitto`,
  class: `classDiagram\n  class Order\n  Kund --> Order\n  ${O}rder --> Kund`,
};

for (const [kind, text] of Object.entries(CASES)) {
  test(`inlärning: ${kind} ritar "${O}rder" och "Order" som två olika namn, och rättningen gör dem till ett`, async () => {
    const before = await mm.render(text);
    assert.equal(before.ok, true, before.error);
    assert.deepEqual(drawn(before), ['Kund', 'Order', `${O}rder`].sort());
    const after = await mm.render(fix(text));
    assert.equal(after.ok, true, after.error);
    assert.deepEqual(drawn(after), ['Kund', 'Order']);
  });
}

test('inlärning: Mermaid godtar breda tecken i namn, och rättningen ger det vanliga namnet', async () => {
  const text = `flowchart LR\n  ${WIDE_O}rder --> Kund`;
  const before = await mm.render(text);
  assert.equal(before.ok, true, before.error);
  assert.deepEqual(drawn(before), ['Kund', `${WIDE_O}rder`]);
  const after = await mm.render(fix(text));
  assert.deepEqual(drawn(after), ['Kund', 'Order']);
});
