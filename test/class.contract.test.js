// Kontraktstester för class diagram mot riktiga Mermaid i en headless-webbläsare.
// Se mermaid.contract.test.js för skillnaden mellan inlärnings- och kontraktstester.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openMermaid } = require('./support/mermaid-browser');

let mm;
test.before(async () => { mm = await openMermaid(); });
test.after(async () => { await mm?.close(); });

const ids = r => r.nodes.map(n => n.id).sort();
const clusters = r => r.clusters.map(c => c.id).sort();

test('inlärning class: klasser är g.node med id <renderId>-classId-<id>-<n>, generics ingår inte i id:t', async () => {
  const r = await mm.render('classDiagram\n  class Animal {\n    +String name\n  }\n  class Cage~T~\n  class Duck["Anka"]');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(ids(r), ['Animal', 'Cage', 'Duck']);
});

test('inlärning class: namespaces är g.cluster med hela sökvägen som id, och kan nästlas', async () => {
  const nested = await mm.render('classDiagram\n  namespace A {\n    namespace B {\n      class X\n    }\n    class Y\n  }');
  assert.deepEqual(clusters(nested), ['A', 'A.B']);
  const dotted = await mm.render('classDiagram\n  namespace A.B {\n    class X\n  }');
  assert.deepEqual(clusters(dotted), ['A', 'A.B']);
});

test('inlärning class: relationer skapar klasser, och dubbletter ritas båda', async () => {
  const r = await mm.render('classDiagram\n  class A\n  A <|-- B\n  A <|-- B\n  A "1" *-- "many" C : har');
  assert.deepEqual(ids(r), ['A', 'B', 'C']);
  assert.equal(r.edges, 3);
});

test('inlärning class: en tom namespace ger syntaxfel', async () => {
  const r = await mm.render('classDiagram\n  namespace X {\n  }\n  class A');
  assert.equal(r.ok, false);
});

test('inlärning class: annotation på en okänd klass kraschar, medlemsrad skapar klassen', async () => {
  assert.equal((await mm.render('classDiagram\n  <<interface>> Ghost\n  class A')).ok, false);
  assert.deepEqual(ids(await mm.render('classDiagram\n  Ghost : +x\n  class A')), ['A', 'Ghost']);
});

test('inlärning class: style, cssClass, click, link och callback på en okänd klass skapar ingenting', async () => {
  for (const line of ['style Ghost fill:#f9f', 'cssClass "Ghost" hot', 'click Ghost href "https://x.se"', 'link Ghost "https://x.se"', 'callback Ghost "cb"']) {
    const r = await mm.render(`classDiagram\n  ${line}\n  class A`);
    assert.equal(r.ok, true, `${line}: ${r.error}`);
    assert.deepEqual(ids(r), ['A'], line);
  }
});

test('inlärning class: note for ger en egen anteckningsnod, även på en okänd klass', async () => {
  const r = await mm.render('classDiagram\n  class A\n  note for A "a"\n  note for Ghost "g"\n  note "fri"');
  assert.deepEqual(ids(r), ['A']);
  assert.equal(r.notes.length, 3);
});

test('inlärning class: en länkad klass ligger i ett a-element', async () => {
  const r = await mm.render('classDiagram\n  class A\n  A --> B\n  click A href "https://x.se"');
  assert.deepEqual(ids(r), ['A', 'B']);
});

test('inlärning class: id med punkt och etikett går att använda som ersättning för ett namespace', async () => {
  const r = await mm.render('classDiagram\n  namespace A {\n    class A.B["B (+2)"]\n    class Y\n  }\n  A.B --> C');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(ids(r), ['A.B', 'C', 'Y']);
  assert.deepEqual(clusters(r), ['A']);
});

// ---------------------------------------------------------------- kontrakt: parser ⇄ Mermaid

const fs = require('node:fs');
const path = require('node:path');
const { parseClass, filterClass } = require('../out/classParser');
const { visibility, collapse, neighborhood, nodeKey, edgeKey, subgraphKey, collapseKey } = require('../out/parser');

const SAMPLES = path.join(__dirname, '..', 'samples');
const samples = fs.readdirSync(SAMPLES).filter(f => f.endsWith('.mmd'))
  .map(f => ({ name: f, text: fs.readFileSync(path.join(SAMPLES, f), 'utf8') }))
  .filter(s => parseClass(s.text).supported);

/** Det parsern säger att Mermaid ska rita: klasser, hopfällda namespaces, kluster, relationer och anteckningar. */
function expected(model, hidden) {
  const vis = visibility(model, hidden);
  const col = collapse(model, hidden);
  const absorbed = id => col.owner(id) !== undefined;
  const visibleIn = sg => [...model.nodes.values()].some(n => {
    if (vis.isNodeHidden(n.id)) return false;
    for (let cur = n.subgraph; cur; cur = model.subgraphs.get(cur)?.parent) if (cur === sg) return true;
    return false;
  });
  const kept = [...col.kept.values()];
  // Varje synlig klass ritas, även en som bara fanns i en dold relation.
  const nodes = [
    ...[...model.nodes.keys()].filter(id => !vis.isNodeHidden(id) && !absorbed(id)),
    ...[...model.subgraphs.keys()].filter(sg => col.owner(sg) === sg && col.count(sg) > 0),
  ];
  const clusters = [...model.subgraphs.keys()].filter(sg => !vis.isSubgraphHidden(sg) && !absorbed(sg) && visibleIn(sg));
  const notes = model.lines.filter(l => l.kind === 'noteFor' && !vis.isNodeHidden(l.id) && !absorbed(l.id)).length;
  return { nodes: nodes.sort(), clusters: clusters.sort(), edges: kept.length, notes };
}

async function assertMatches(model, hidden, label) {
  const r = await mm.render(filterClass(model, hidden));
  assert.equal(r.ok, true, `${label}: ${r.error}`);
  const want = expected(model, hidden);
  // Lollipop-gränssnitt ritas som noder utan klass-id.
  assert.deepEqual(r.nodes.map(n => n.id).filter(id => id !== null).sort(), want.nodes, `${label}: klasser`);
  assert.deepEqual(clusters(r), want.clusters, `${label}: namespaces`);
  assert.equal(r.edges, want.edges, `${label}: relationer`);
  assert.equal(r.notes.length, want.notes, `${label}: anteckningar`);
}

for (const sample of samples) {
  test(`kontrakt ${sample.name}: Mermaid ritar det parsern ser`, async () => {
    await assertMatches(parseClass(sample.text), new Set(), sample.name);
  });

  test(`kontrakt ${sample.name}: varje enskilt dolt element`, async () => {
    const model = parseClass(sample.text);
    const keys = [
      ...[...model.nodes.keys()].map(nodeKey),
      ...model.edges.map(e => edgeKey(e.key)),
      ...[...model.subgraphs.keys()].map(subgraphKey),
    ];
    for (const key of keys) await assertMatches(model, new Set([key]), `${sample.name} dold ${key}`);
  });

  test(`kontrakt ${sample.name}: fokusläge för varje klass`, async () => {
    const model = parseClass(sample.text);
    for (const id of model.nodes.keys()) {
      const keep = neighborhood(model, id, 1);
      await assertMatches(model, new Set([...model.nodes.keys()].filter(n => !keep.has(n)).map(nodeKey)), `${sample.name} fokus ${id}`);
    }
  });

  test(`kontrakt ${sample.name}: varje namespace hopfälld, ensam och med varje dold klass eller relation`, async () => {
    const model = parseClass(sample.text);
    for (const sg of model.subgraphs.keys()) {
      await assertMatches(model, new Set([collapseKey(sg)]), `${sample.name} hopfälld ${sg}`);
      for (const key of [...[...model.nodes.keys()].map(nodeKey), ...model.edges.map(e => edgeKey(e.key))]) {
        await assertMatches(model, new Set([collapseKey(sg), key]), `${sample.name} hopfälld ${sg}, dold ${key}`);
      }
    }
  });

  test(`kontrakt ${sample.name}: alla namespaces hopfällda`, async () => {
    const model = parseClass(sample.text);
    await assertMatches(model, new Set([...model.subgraphs.keys()].map(collapseKey)), `${sample.name} alla hopfällda`);
  });
}
