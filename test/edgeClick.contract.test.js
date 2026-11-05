// Kontrakt för klick på en pils text, mot riktiga Mermaid: texterna som förhandsvisningen läser
// ur SVG:n (Labels.edgeTexts) ska med edgeAtClick leda till rätt kant i koden, för alla exempel.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./support/mermaid-browser');
const { parseDiagram, filterDiagram } = require('../out/diagram');
const { edgeAtClick, labelText } = require('../out/edgeClick');
const { collapseKey, nodeKey } = require('../out/parser');

const MERMAID_JS = path.join(__dirname, '..', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const LABELS_JS = path.join(__dirname, '..', 'media', 'labels.js');
const SAMPLES = path.join(__dirname, '..', 'samples');

let browser, page;
test.before(async () => {
  browser = await launch();
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.setContent('<div id="s"></div>');
  await page.addScriptTag({ path: MERMAID_JS });
  await page.addScriptTag({ path: LABELS_JS });
});
test.after(async () => { await browser?.close(); });

/** Ritar texten och ger piltexterna som förhandsvisningen ser dem, med kantens data-id om det finns. */
function drawn(text) {
  return page.evaluate(async text => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const { svg } = await mermaid.render(`ec${Math.random().toString(36).slice(2)}`, text);
    s.innerHTML = svg;
    const el = s.querySelector('svg');
    const items = Labels.edgeTexts(el);
    // Klick på texten (eller något inuti den) ska hitta samma plats i listan.
    const found = items.map(({ el: t }) => Labels.edgeTextIndex(el, t.querySelector('*') || t));
    return { texts: items.map(i => i.text), found, dataIds: items.map(({ el: t }) => t.querySelector('[data-id]')?.getAttribute('data-id') ?? null) };
  }, text);
}

/** Kontrollerar att varje ritad text leder till en kant med den texten, och att kanterna stämmer med SVG:n. */
async function check(model, hidden, name) {
  const { texts, found, dataIds } = await drawn(filterDiagram(model, hidden));
  assert.deepEqual(found, texts.map((_, i) => i), `${name}: klick hittar texten`);
  const seq = model.diagramType === 'sequenceDiagram';
  const edges = texts.map((_, i) => edgeAtClick(model, hidden, texts, i));
  texts.forEach((t, i) => {
    const e = edges[i];
    assert.ok(e, `${name}: ingen kant för "${t}"`);
    const want = seq ? e.label.split(/<br\s*\/?>/i).map(labelText) : [labelText(e.label)];
    assert.ok(want.includes(labelText(t)), `${name}: "${t}" gav kanten ${e.key} "${e.label}"`);
    // Flowchart (L_från_till_n) och class (id_från_till_n) har ändarna i data-id.
    const ends = /^(?:L|id)_(.+)_\d+$/.exec(dataIds[i] ?? '');
    if (ends && !hidden.size) assert.equal(ends[1], `${e.from}_${e.to}`, `${name}: "${t}" ritades på ${dataIds[i]}`);
  });
  if (!seq) assert.equal(new Set(edges).size, edges.length, `${name}: två texter gav samma kant`);
  return texts.length;
}

for (const file of fs.readdirSync(SAMPLES).filter(f => f.endsWith('.mmd'))) {
  test(`klick på piltext: ${file}`, async () => {
    const model = parseDiagram(fs.readFileSync(path.join(SAMPLES, file), 'utf8'));
    if (!model.supported) return;
    const n = await check(model, new Set(), file);
    // Med första gruppen hopfälld och första noden dold.
    const sg = [...model.subgraphs.keys()][0];
    const node = [...model.nodes.keys()][0];
    const hidden = new Set([...(sg ? [collapseKey(sg)] : []), ...(node ? [nodeKey(node)] : [])]);
    await check(model, hidden, `${file} med dolt`);
    assert.ok(n > 0 || model.edges.every(e => !e.label), `${file}: inga piltexter hittades`);
  });
}

test('klick på piltext: text med radbrytning och markdown i flowchart, state och class', async () => {
  for (const text of [
    'flowchart LR\n  A -->|go<br/>on| B\n  B -- "`**yes** sir`" --> C\n  C -->|go<br/>on| A',
    'stateDiagram-v2\n  A --> B : go<br>on\n  B --> A : go<br>on',
    'classDiagram\n  A --> B : uses<br>much',
    'sequenceDiagram\n  A->>B: hello<br/>world\n  B-->>A: hello',
  ]) {
    const model = parseDiagram(text);
    assert.ok(await check(model, new Set(), text.split('\n')[0]) > 0);
  }
});
