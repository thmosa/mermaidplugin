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

// Stora exempel (som LargeState.mmd) körs bara i grundtesterna. Kombinationerna blir hundratals
// renderingar på nästan en sekund var, och de mindre exemplen täcker samma regler.
const LARGE = 40;
const combos = model => model.nodes.size > LARGE ? { skip: `stort exempel (${model.nodes.size} noder), bara grundtesterna` } : {};

for (const sample of samples) {
  const size = combos(parseState(sample.text));
  test(`kontrakt ${sample.name}: Mermaid ritar det parsern ser`, async () => {
    await assertMatches(parseState(sample.text), new Set(), sample.name);
  });

  test(`kontrakt ${sample.name}: varje enskilt dolt element`, size, async () => {
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

  test(`kontrakt ${sample.name}: fokusläge för varje tillstånd`, size, async () => {
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

// Vilken grupp ett tillstånd hör till, mätt i den ritade SVG:n: den minsta gruppen som omsluter det.
async function drawnMembership(text) {
  const { launch } = require('./support/mermaid-browser');
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.setContent('<div id="s"></div>');
    await page.addScriptTag({ path: path.join(__dirname, '..', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js') });
    return await page.evaluate(async text => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      const { svg } = await mermaid.render('mb', text);
      s.innerHTML = svg;
      const el = s.querySelector('svg');
      const re = /-state-(.+)-\d+$/;
      const clusters = [...el.querySelectorAll('g.statediagram-cluster')]
        .map(g => ({ id: re.exec(g.id)?.[1], r: g.getBoundingClientRect() })).filter(c => c.id);
      const out = {};
      for (const n of el.querySelectorAll('g.node')) {
        const id = re.exec(n.id)?.[1];
        if (!id || n.classList.contains('statediagram-note') || clusters.some(c => c.id === id)) continue;
        const r = n.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        out[id] = clusters.filter(c => cx > c.r.left && cx < c.r.right && cy > c.r.top && cy < c.r.bottom)
          .sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height)[0]?.id ?? null;
      }
      return out;
    }, text);
  } finally {
    await browser.close();
  }
}

const parsedMembership = text => Object.fromEntries([...parseState(text).nodes.values()].map(n => [n.id, n.subgraph ?? null]));

test('inlärning state: ett tillstånd som nämns både utanför och inuti ett sammansatt tillstånd ritas inuti', async () => {
  const outsideFirst = 'stateDiagram-v2\n  A --> X\n  state W {\n    [*] --> X\n    X --> Y\n  }';
  const insideFirst = 'stateDiagram-v2\n  state W {\n    [*] --> X\n    X --> Y\n  }\n  A --> X';
  const declOutside = 'stateDiagram-v2\n  X : beskrivning\n  state W {\n    X --> Y\n  }';
  for (const text of [outsideFirst, insideFirst, declOutside]) {
    const drawn = await drawnMembership(text);
    assert.equal(drawn.X, 'W', text);
    assert.deepEqual(parsedMembership(text), drawn, text);
  }
});

test('inlärning state: nämns tillståndet i två sammansatta tillstånd hamnar det i det sista', async () => {
  const text = 'stateDiagram-v2\n  state V {\n    X --> P\n  }\n  state W {\n    X --> Q\n  }';
  const drawn = await drawnMembership(text);
  assert.equal(drawn.X, 'W');
  assert.deepEqual(parsedMembership(text), drawn);
});

test('kontrakt state: trädets grupper stämmer med det ritade i LargeState.mmd', async () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'samples', 'LargeState.mmd'), 'utf8');
  const drawn = await drawnMembership(text);
  const parsed = parsedMembership(text);
  assert.deepEqual(Object.fromEntries(Object.keys(drawn).map(id => [id, parsed[id]])), drawn);
});
