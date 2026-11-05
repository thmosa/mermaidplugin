// Kontrakt för "Rename all names in this file": varje exempel, omdöpt till varje stil,
// ska fortfarande ritas av riktiga Mermaid med lika många noder, grupper och kanter.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openMermaid } = require('./support/mermaid-browser');
const { fixAll } = require('../out/naming');
const { parseDiagram } = require('../out/diagram');

const SAMPLES = path.join(__dirname, '..', 'samples');
let mm;
test.before(async () => { mm = await openMermaid({ pages: 3 }); });
test.after(async () => { await mm?.close(); });

const shape = r => ({ nodes: r.nodes.length, clusters: r.clusters.length, edges: r.edges, messages: r.seq.messages.length, actors: r.seq.actors.length });

for (const file of fs.readdirSync(SAMPLES).filter(f => f.endsWith('.mmd'))) {
  test(`namnregler: ${file} ritas likadant efter att alla namn bytts`, async () => {
    const text = fs.readFileSync(path.join(SAMPLES, file), 'utf8');
    if (!parseDiagram(text).supported) return;
    const before = await mm.render(text);
    if (!before.ok) return; // syntax.mmd är trasig med flit
    const renamed = await Promise.all(['camelCase', 'PascalCase', 'snake_case'].map(async style => {
      const fixed = fixAll(text, style);
      const after = await mm.render(fixed.text);
      assert.equal(after.ok, true, `${style}: ${after.error}`);
      assert.deepEqual(shape(after), shape(before), style);
      // Texterna på pilarna är oförändrade.
      assert.deepEqual(after.seq.messages, before.seq.messages, style);
      return fixed.renamed.length;
    }));
    assert.ok(renamed.some(n => n > 0), 'inget namn byttes, så testet visar ingenting');
  });
}
