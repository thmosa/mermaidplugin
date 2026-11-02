// Kontraktstester mot riktiga Mermaid i en headless-webbläsare.
//
// Två sorters tester:
// - Inlärningstester låser fast hur Mermaid beter sig (SVG-id:n, klasser, kända fel).
//   Slår ett sådant test fel efter en Mermaid-uppgradering har beteendet ändrats,
//   och koden som bygger på det måste ses över.
// - Kontraktstester kontrollerar att parserns tolkning och filtrering stämmer med
//   vad Mermaid faktiskt ritar.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openMermaid } = require('./support/mermaid-browser');

let mm;
test.before(async () => { mm = await openMermaid(); });
test.after(async () => { await mm?.close(); });

test('inlärning: nodens SVG-id är <renderId>-flowchart-<id>-<n>, utan data-id', async () => {
  const r = await mm.render('flowchart LR\n  A --> B');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.nodes.map(n => n.id), ['A', 'B']);
  for (const n of r.nodes) {
    assert.match(n.domId, new RegExp(`^${r.renderId}-flowchart-${n.id}-\\d+$`));
    assert.equal(n.dataId, null);
  }
});

test('inlärning: subgrafens SVG-id är <renderId>-<id>', async () => {
  const r = await mm.render('flowchart LR\n  subgraph backend [Backend]\n    A\n  end');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.clusters.map(c => c.domId), [`${r.renderId}-backend`]);
});

test('inlärning: stilen handDrawn ger noderna klassen rough-node i stället för node', async () => {
  const r = await mm.render('flowchart LR\n  A --> B', { look: 'handDrawn' });
  assert.equal(r.ok, true, r.error);
  for (const n of r.nodes) {
    assert.match(n.classes, /\brough-node\b/);
    assert.doesNotMatch(n.classes, /(^|\s)node(\s|$)/);
  }
});

test('inlärning: varje kant ritas som en path i g.edgePaths', async () => {
  const r = await mm.render('flowchart LR\n  A --> B --> C\n  A & B --- D');
  assert.equal(r.edges, 4);
});

test('inlärning: ELK och dagre ger samma nod-id:n', async () => {
  const text = 'flowchart LR\n  A --> B\n  subgraph s\n    C\n  end';
  for (const layout of ['dagre', 'elk', 'elk.stress']) {
    const r = await mm.render(text, { layout });
    assert.equal(r.ok, true, `${layout}: ${r.error}`);
    assert.deepEqual(r.nodes.map(n => n.id).sort(), ['A', 'B', 'C'], layout);
    assert.deepEqual(r.clusters.map(c => c.id), ['s'], layout);
  }
});

// ---------------------------------------------------------------- kända fel i Mermaid 12.1
// Slår dessa fel har Mermaid ändrat beteende: se över parsern och UTREDNING.md.

test('känt Mermaid-fel: %% i radslut ger syntaxfel', async () => {
  const r = await mm.render('flowchart LR\n  A --> B %% kommentar');
  assert.equal(r.ok, false);
  assert.match(r.error, /Parse error/);
});

// Tidigare trodde vi att Mermaid tappade resten av diagrammet här. Det var testets XML-tolkning
// (DOMParser) som avbröt på en <br> utan sluttagg; HTML-tolkningen, som förhandsvisningen använder, får med allt.
test('inlärning: sträng över flera rader ritar hela diagrammet', async () => {
  const r = await mm.render('flowchart LR\n  ML["`Rad ett\n  Rad två`"] --> N\n  N --> O');
  assert.equal(r.ok, true);
  assert.deepEqual(r.nodes.map(n => n.id), ['ML', 'N', 'O']);
  assert.equal(r.edges, 2);
});

test('känt Mermaid-fel: ELK lägger kantetiketter ovanpå varandra när kanter korsar in i en subgraf', async () => {
  const r = await mm.labelOverlaps(CROSSING, { layout: 'elk' });
  assert.equal(r.ok, true, r.error);
  assert.ok(r.before > 0, `väntade överlapp, fick ${JSON.stringify(r)}`);
});

// ---------------------------------------------------------------- kontrakt: etiketter isär

const CROSSING = 'flowchart LR\n subgraph f\n a\n b\n end\n subgraph g\n x --> y\n end\n a -->|HTTPS| x\n b -->|HTTPS| x';

for (const layout of ['elk', 'dagre', 'elk.stress']) {
  test(`kontrakt: inga kantetiketter överlappar efter Labels.spread (${layout})`, async () => {
    const cases = [
      CROSSING,
      'flowchart LR\n subgraph f\n a\n b\n c\n end\n subgraph g\n direction TB\n x --> y\n end\n a & b & c -->|API| x',
      'flowchart TB\n subgraph f\n a\n b\n end\n subgraph g\n x\n end\n a -->|ett| x\n b -->|två| x',
      ...samples.map(s => s.text),
    ];
    for (const text of cases) {
      const r = await mm.labelOverlaps(text, { layout });
      assert.equal(r.ok, true, r.error);
      assert.equal(r.after, 0, `${layout}: ${JSON.stringify(r)}\n${text}`);
    }
  });
}

// ---------------------------------------------------------------- kontrakt: parser ⇄ Mermaid

const fs = require('node:fs');
const path = require('node:path');
const { parseFlowchart, filterFlowchart, visibility, nodeKey, edgeKey, subgraphKey } = require('../out/parser');

const SAMPLES = path.join(__dirname, '..', 'samples');
// Bara diagram som parsern stöder (flowchart/graph); andra typer har inget träd att jämföra.
const samples = fs.readdirSync(SAMPLES).filter(f => f.endsWith('.mmd'))
  .map(f => ({ name: f, text: fs.readFileSync(path.join(SAMPLES, f), 'utf8') }))
  .filter(s => parseFlowchart(s.text).supported);

/** Det parsern säger ska synas när `hidden` är dolda. */
function expected(model, hidden) {
  const vis = visibility(model, hidden);
  const nodes = [...model.nodes.keys()].filter(id => !vis.isNodeHidden(id)).sort();
  const edges = model.edges.filter(e => !vis.isEdgeHidden(e)).length;
  const hasVisible = id => [...model.nodes.values()].some(n => {
    for (let sg = n.subgraph; sg; sg = model.subgraphs.get(sg)?.parent) if (sg === id) return !vis.isNodeHidden(n.id);
    return false;
  });
  const clusters = [...model.subgraphs.keys()].filter(id => !vis.isSubgraphHidden(id) && hasVisible(id)).sort();
  return { nodes, edges, clusters };
}

async function assertMatches(model, hidden, label) {
  const r = await mm.render(filterFlowchart(model, hidden));
  assert.equal(r.ok, true, `${label}: ${r.error}`);
  const want = expected(model, hidden);
  assert.deepEqual(r.nodes.map(n => n.id).sort(), want.nodes, `${label}: noder`);
  assert.equal(r.edges, want.edges, `${label}: antal kanter`);
  assert.deepEqual(r.clusters.map(c => c.id).sort(), want.clusters, `${label}: subgrafer`);
}

for (const sample of samples) {
  test(`kontrakt ${sample.name}: Mermaid ritar det parsern ser`, async () => {
    await assertMatches(parseFlowchart(sample.text), new Set(), sample.name);
  });

  test(`kontrakt ${sample.name}: varje enskilt dolt element ger giltigt diagram med rätt innehåll`, async () => {
    const model = parseFlowchart(sample.text);
    const keys = [
      ...[...model.nodes.keys()].map(nodeKey),
      ...model.edges.map(e => edgeKey(e.key)),
      ...[...model.subgraphs.keys()].map(subgraphKey),
    ];
    for (const key of keys) await assertMatches(model, new Set([key]), `${sample.name} dold ${key}`);
  });
}

test('kontrakt: nästlade subgrafer utan id får samma id som Mermaid ger dem', async () => {
  const text = 'flowchart LR\n  subgraph Yttre grupp\n    subgraph Inre grupp\n      A\n    end\n    B\n  end\n  subgraph Tredje\n    C\n  end';
  const model = parseFlowchart(text);
  const r = await mm.render(text);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.clusters.map(c => c.id).sort(), [...model.subgraphs.keys()].sort());
});

const { neighborhood } = require('../out/parser');

for (const sample of samples) {
  test(`kontrakt ${sample.name}: subgraf vars alla noder döljs en och en försvinner`, async () => {
    const model = parseFlowchart(sample.text);
    for (const sg of model.subgraphs.keys()) {
      const inside = [...model.nodes.values()].filter(n => {
        for (let s = n.subgraph; s; s = model.subgraphs.get(s)?.parent) if (s === sg) return true;
        return false;
      });
      await assertMatches(model, new Set(inside.map(n => nodeKey(n.id))), `${sample.name} alla noder i ${sg} dolda`);
    }
  });

  test(`kontrakt ${sample.name}: fokusläge (nod + grannar) för varje nod`, async () => {
    const model = parseFlowchart(sample.text);
    for (const id of model.nodes.keys()) {
      const keep = neighborhood(model, id, 1);
      const hidden = new Set([...model.nodes.keys()].filter(n => !keep.has(n)).map(nodeKey));
      await assertMatches(model, hidden, `${sample.name} fokus ${id}`);
    }
  });
}
