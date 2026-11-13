// Kontraktstester för hopfällning mot riktiga Mermaid: en hopfälld grupp ska ritas som
// en enda nod, utan kluster, och med exakt de omdragna kanter som modellen säger.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openMermaid } = require('./support/mermaid-browser');
const { focusHidden } = require('../out/chain');
const { parseDiagram, filterDiagram } = require('../out/diagram');
const { visibility, collapse, collapseKey, nodeKey } = require('../out/parser');

let mm;
test.before(async () => { mm = await openMermaid(); });
test.after(async () => { await mm?.close(); });

const SAMPLES = path.join(__dirname, '..', 'samples');
const samples = fs.readdirSync(SAMPLES).filter(f => f.endsWith('.mmd'))
  .map(f => ({ name: f, model: parseDiagram(fs.readFileSync(path.join(SAMPLES, f), 'utf8')) }))
  // Flowchart och state; sequence och class har egna kontrakt för hopfällning.
  .filter(s => s.model.supported && s.model.subgraphs.size > 0 && !/^(sequenceDiagram|classDiagram)/.test(s.model.diagramType));

/** Det modellen säger att Mermaid ska rita. */
function expected(model, hidden) {
  const vis = visibility(model, hidden);
  const col = collapse(model, hidden);
  const kept = [...col.kept.values()];
  const touched = new Set(kept.flatMap(e => [e.from, e.to]));
  const absorbed = id => { const o = col.owner(id); return o !== undefined && o !== id; };
  const hasVisible = sg => [...model.nodes.values()].some(n => {
    if (n.pseudo || vis.isNodeHidden(n.id)) return false;
    for (let cur = n.subgraph; cur; cur = model.subgraphs.get(cur)?.parent) if (cur === sg) return true;
    return false;
  });
  const groups = [...model.subgraphs.keys()].filter(id => !vis.isSubgraphHidden(id) && hasVisible(id) && !absorbed(id));
  const clusters = groups.filter(id => col.owner(id) === undefined);
  const collapsed = groups.filter(id => col.owner(id) === id);
  const nodes = [
    ...[...model.nodes.values()].filter(n => !vis.isNodeHidden(n.id) && !absorbed(n.id) && (!n.pseudo || touched.has(n.id))).map(n => n.id),
    ...collapsed,
    // Grupp utan synligt innehåll som en kant ändå pekar på ritas som vanlig nod.
    ...[...model.subgraphs.keys()].filter(id => !groups.includes(id) && !absorbed(id) && touched.has(id)),
  ];
  return { nodes: nodes.sort(), edges: kept.length, clusters: clusters.sort() };
}

const clusterIds = r => r.clusters.map(c => c.id).filter(id => !/^(divider-)?id-/.test(id)).sort();

async function assertMatches(model, hidden, label) {
  const r = await mm.render(filterDiagram(model, hidden));
  assert.equal(r.ok, true, `${label}: ${r.error}`);
  const want = expected(model, hidden);
  assert.deepEqual(r.nodes.map(n => n.id).sort(), want.nodes, `${label}: noder`);
  assert.equal(r.edges, want.edges, `${label}: antal kanter`);
  assert.deepEqual(clusterIds(r), want.clusters, `${label}: grupper`);
}

// Stora exempel (som LargeState.mmd) körs bara i grundtesterna. Kombinationerna blir hundratals
// renderingar på nästan en sekund var, och de mindre exemplen täcker samma regler.
const LARGE = 40;
const combos = model => model.nodes.size > LARGE ? { skip: `stort exempel (${model.nodes.size} noder), bara grundtesterna` } : {};

// Samma state i två sammansatta states: Mermaid ritar en enda state, och hopfällning räknar då pilarna
// annorlunda än modellen. Tillägget varnar för det (sharedStates), så de exemplen hoppas över här.
const { sharedStates } = require('../out/sharedStates');
const sharedSkip = (name, model) => {
  const shared = sharedStates(fs.readFileSync(path.join(SAMPLES, name), 'utf8'), model);
  return shared.length ? { skip: `samma state i två sammansatta states (${[...new Set(shared.map(s => s.id))].join(', ')}), som tillägget varnar för` } : {};
};

for (const { name, model } of samples) {
  test(`kontrakt hopfällning ${name}: varje grupp hopfälld för sig`, sharedSkip(name, model), async () => {
    for (const sg of model.subgraphs.keys()) await assertMatches(model, new Set([collapseKey(sg)]), `${name} hopfälld ${sg}`);
  });

  test(`kontrakt hopfällning ${name}: alla grupper hopfällda`, sharedSkip(name, model), async () => {
    await assertMatches(model, new Set([...model.subgraphs.keys()].map(collapseKey)), `${name} alla hopfällda`);
  });

  test(`kontrakt kedja ${name}: Focus från varje grupp: ut, in och in och ut`, async () => {
    const { chain, focusHidden } = require('../out/chain');
    for (const sg of model.subgraphs.keys()) {
      for (const [dir, steps] of [['follow', Infinity], ['against', Infinity], ['both', 2], ['both', Infinity]]) {
        const keep = chain(model, { kind: 'subgraph', id: sg }, dir, steps);
        await assertMatches(model, new Set(focusHidden(model, keep)), `${name} kedja ${dir} ${steps} ${sg}`);
      }
    }
  });

  test(`kontrakt kedja ${name}: Focus från varje nod: in och ut, hela kedjan`, combos(model), async () => {
    const { chain, focusHidden } = require('../out/chain');
    for (const id of model.nodes.keys()) {
      const keep = chain(model, { kind: 'node', id }, 'both', Infinity);
      await assertMatches(model, new Set(focusHidden(model, keep)), `${name} kedja ${id}`);
    }
  });

  test(`kontrakt fokus ${name}: fokus på varje grupp (gruppen och det som har pilar till den)`, async () => {
    const { groupNeighborhood } = require('../out/parser');
    for (const sg of model.subgraphs.keys()) {
      const keep = groupNeighborhood(model, sg);
      await assertMatches(model, new Set(focusHidden(model, keep)), `${name} fokus ${sg}`);
    }
  });

  test(`kontrakt hopfällning ${name}: hopfälld grupp och en dold nod`, combos(model), async () => {
    for (const sg of model.subgraphs.keys()) {
      for (const id of model.nodes.keys()) {
        await assertMatches(model, new Set([collapseKey(sg), nodeKey(id)]), `${name} hopfälld ${sg}, dold ${id}`);
      }
    }
  });
}
