// Kontrakt för sammanslagna klassdiagram: riktiga Mermaid ritar resultatet som parsern tolkar det.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openMermaid } = require('./support/mermaid-browser');
const { mergeClassDiagrams } = require('../out/mergeClass');
const { parseDiagram } = require('../out/diagram');

let mm;
test.before(async () => { mm = await openMermaid({ pages: 2 }); });
test.after(async () => { await mm?.close(); });

const file = (name, ...lines) => ({ name, text: ['classDiagram', ...lines].join('\n') });
const shape = r => ({ nodes: r.nodes.map(n => n.id).sort(), clusters: r.clusters.length, edges: r.edges });

test('kontrakt: två diagram blir ett med klasserna och relationerna från båda', async () => {
  const r = mergeClassDiagrams([
    file('kund.mmd', '  direction LR', '  class Kund {', '    +namn', '  }', '  Kund "1" --> "*" Order : gör'),
    file('order.mmd', '  direction LR', '  class Kund {', '    +namn', '    +epost', '  }', '  Kund "1" --> "*" Order : gör', '  Order --> Rad : har'),
  ]);
  const out = await mm.render(r.text);
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.nodes.map(n => n.id).sort(), ['Kund', 'Order', 'Rad']);
  assert.equal(out.edges, 2);
});

test('kontrakt: en klass vars alla medlemmar redan fanns ritas ändå', async () => {
  const r = mergeClassDiagrams([
    file('a.mmd', '  class Kund {', '    +namn', '  }'),
    file('b.mmd', '  class Kund {', '    +namn', '  }'),
  ]);
  const out = await mm.render(r.text);
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.nodes.map(n => n.id), ['Kund']);
});

test('kontrakt: namespaces från flera filer ritas som ett', async () => {
  const r = mergeClassDiagrams([
    file('a.mmd', '  namespace Shop {', '    class Kund', '  }'),
    file('b.mmd', '  namespace Shop {', '    class Order', '  }', '  Kund --> Order'),
  ]);
  const out = await mm.render(r.text);
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(shape(out), { nodes: ['Kund', 'Order'], clusters: 1, edges: 1 });
});

const SAMPLES = path.join(__dirname, '..', 'samples');
for (const sample of fs.readdirSync(SAMPLES).filter(f => f.endsWith('.mmd') && parseDiagram(fs.readFileSync(path.join(SAMPLES, f), 'utf8')).diagramType === 'classDiagram')) {
  test(`kontrakt: ${sample} ihopslagen med sig själv ritas som ursprunget`, async () => {
    const text = fs.readFileSync(path.join(SAMPLES, sample), 'utf8');
    const before = await mm.render(text);
    assert.equal(before.ok, true, before.error);
    const r = mergeClassDiagrams([{ name: 'a.mmd', text }, { name: 'b.mmd', text }]);
    assert.deepEqual(r.conflicts, []);
    const after = await mm.render(r.text);
    assert.equal(after.ok, true, after.error);
    assert.deepEqual(shape(after), shape(before));
    assert.equal(parseDiagram(r.text).edges.length, parseDiagram(text).edges.length);
  });
}
