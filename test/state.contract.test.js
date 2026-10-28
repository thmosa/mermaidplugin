// Kontraktstester för state diagram mot riktiga Mermaid i en headless-webbläsare.
// Se mermaid.contract.test.js för skillnaden mellan inlärnings- och kontraktstester.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openMermaid } = require('./support/mermaid-browser');

let mm;
test.before(async () => { mm = await openMermaid(); });
test.after(async () => { await mm?.close(); });

const ids = r => r.nodes.map(n => n.id).sort();
const clusterIds = r => r.clusters.map(c => c.id).filter(id => !/^(divider-)?id-/.test(id)).sort();

test('inlärning state: tillståndets SVG-id är <renderId>-state-<id>-<n>', async () => {
  const r = await mm.render('stateDiagram-v2\n  Still --> Moving');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(ids(r), ['Moving', 'Still']);
  for (const n of r.nodes) assert.match(n.domId, new RegExp(`^${r.renderId}-state-${n.id}-\\d+$`));
});

test('inlärning state: [*] blir root_start/root_end, och <Sammansatt>_start/_end inuti ett sammansatt tillstånd', async () => {
  const r = await mm.render('stateDiagram-v2\n  [*] --> A\n  A --> [*]\n  [*] --> B\n  state A {\n    [*] --> a\n    a --> [*]\n  }');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(ids(r), ['A_end', 'A_start', 'B', 'a', 'root_end', 'root_start']);
  assert.equal(r.edges, 5);
});

test('inlärning state: sammansatt tillstånd ritas som g.statediagram-cluster med samma id-form som noder', async () => {
  const r = await mm.render('stateDiagram-v2\n  state "Stor grupp" as G {\n    x --> y\n    state Inner {\n      a\n    }\n  }');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(clusterIds(r), ['G', 'Inner']);
  assert.deepEqual(ids(r), ['a', 'x', 'y']);
});

test('inlärning state: parallella regioner (--) ger extra kluster med slumpade id:n', async () => {
  const r = await mm.render('stateDiagram-v2\n  state P {\n    a1 --> a2\n    --\n    b1 --> b2\n  }');
  assert.equal(r.ok, true, r.error);
  assert.ok(r.clusters.length > 1);
  assert.deepEqual(clusterIds(r), ['P']);
});

test('inlärning state: anteckningar är egna noder med egen kant', async () => {
  const r = await mm.render('stateDiagram-v2\n  A --> B\n  note right of A : kort\n  note left of B\n    lång\n  end note');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(ids(r), ['A', 'B']);
  assert.equal(r.notes.length, 2);
  assert.equal(r.edges, 1);
});

test('inlärning state: fork, join och choice är vanliga tillståndsnoder', async () => {
  const r = await mm.render('stateDiagram-v2\n  state f <<fork>>\n  state j <<join>>\n  state c <<choice>>\n  f --> j\n  j --> c');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(ids(r), ['c', 'f', 'j']);
});

test('inlärning state: "state B" utan något mer ritas inte, men "B" och "state \\"Text\\" as T" gör det', async () => {
  const r = await mm.render('stateDiagram-v2\n  A\n  state B\n  state "Text" as T\n  C : beskrivning');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(ids(r), ['A', 'C', 'T']);
});

// ---------------------------------------------------------------- kontrakt: parser ⇄ Mermaid

const fs = require('node:fs');
const path = require('node:path');
const { parseState, filterState } = require('../out/stateParser');
const { visibility, neighborhood, nodeKey, edgeKey, subgraphKey } = require('../out/parser');

const SAMPLES = path.join(__dirname, '..', 'samples');
const samples = fs.readdirSync(SAMPLES).filter(f => f.endsWith('.mmd'))
  .map(f => ({ name: f, text: fs.readFileSync(path.join(SAMPLES, f), 'utf8') }))
  .filter(s => parseState(s.text).supported);

/** Det parsern säger att Mermaid ska rita när `hidden` är dolda. */
function expected(model, hidden) {
  const vis = visibility(model, hidden);
  const edges = model.edges.filter(e => !vis.isEdgeHidden(e));
  const hasVisible = id =>
    [...model.nodes.values()].some(n => n.subgraph === id && !n.pseudo && !vis.isNodeHidden(n.id)) ||
    [...model.subgraphs.values()].some(s => s.parent === id && hasVisible(s.id));
  const clusters = [...model.subgraphs.keys()].filter(id => !vis.isSubgraphHidden(id) && hasVisible(id));
  const touched = new Set(edges.flatMap(e => [e.from, e.to]));
  const nodes = [
    ...[...model.nodes.values()].filter(n => !vis.isNodeHidden(n.id) && (!n.pseudo || touched.has(n.id))).map(n => n.id),
    // Ett sammansatt tillstånd utan synligt innehåll ritas som vanligt tillstånd om en övergång rör det.
    ...[...model.subgraphs.keys()].filter(id => !clusters.includes(id) && touched.has(id)),
  ];
  return { nodes: nodes.sort(), edges: edges.length, clusters: clusters.sort() };
}

async function assertMatches(model, hidden, label) {
  const r = await mm.render(filterState(model, hidden));
  assert.equal(r.ok, true, `${label}: ${r.error}`);
  const want = expected(model, hidden);
  assert.deepEqual(ids(r), want.nodes, `${label}: tillstånd`);
  assert.equal(r.edges, want.edges, `${label}: antal övergångar`);
  assert.deepEqual(clusterIds(r), want.clusters, `${label}: sammansatta tillstånd`);
}

for (const sample of samples) {
  test(`kontrakt ${sample.name}: Mermaid ritar det parsern ser`, async () => {
    await assertMatches(parseState(sample.text), new Set(), sample.name);
  });

  test(`kontrakt ${sample.name}: varje enskilt dolt element`, async () => {
    const model = parseState(sample.text);
    const keys = [
      ...[...model.nodes.keys()].map(nodeKey),
      ...model.edges.map(e => edgeKey(e.key)),
      ...[...model.subgraphs.keys()].map(subgraphKey),
    ];
    for (const key of keys) await assertMatches(model, new Set([key]), `${sample.name} dold ${key}`);
  });

  test(`kontrakt ${sample.name}: alla tillstånd i ett sammansatt tillstånd dolda`, async () => {
    const model = parseState(sample.text);
    for (const sg of model.subgraphs.keys()) {
      const inside = [...model.nodes.values()].filter(n => {
        for (let s = n.subgraph; s; s = model.subgraphs.get(s)?.parent) if (s === sg) return !n.pseudo;
        return false;
      });
      await assertMatches(model, new Set(inside.map(n => nodeKey(n.id))), `${sample.name} allt i ${sg} dolt`);
    }
  });

  test(`kontrakt ${sample.name}: fokusläge för varje tillstånd`, async () => {
    const model = parseState(sample.text);
    for (const id of model.nodes.keys()) {
      const keep = neighborhood(model, id, 1);
      const hidden = new Set([...model.nodes.keys()].filter(n => !keep.has(n)).map(nodeKey));
      await assertMatches(model, hidden, `${sample.name} fokus ${id}`);
    }
  });
}

test('inlärning state: stateDiagram (v1) ritas likadant som v2', async () => {
  const r = await mm.render('stateDiagram\n  [*] --> A\n  A --> B');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(ids(r), ['A', 'B', 'root_start']);
});
