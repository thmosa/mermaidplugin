// Kontraktstester för sequence diagram mot riktiga Mermaid i en headless-webbläsare.
// Se mermaid.contract.test.js för skillnaden mellan inlärnings- och kontraktstester.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openMermaid } = require('./support/mermaid-browser');

let mm;
// Kontrakten nedan renderar över tusen varianter; fyra flikar delar på dem.
test.before(async () => { mm = await openMermaid({ pages: 4 }); });
test.after(async () => { await mm?.close(); });

const actors = r => [...r.seq.actors].sort();

test('inlärning sequence: deltagare har bara ett name-attribut, både participant och actor', async () => {
  const r = await mm.render('sequenceDiagram\n  participant A as Alice\n  actor B as Bob\n  A->>B: hej\n  A-)C: async');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(actors(r), ['A', 'B', 'C']);
  assert.deepEqual(r.seq.messages, ['hej', 'async']);
});

test('inlärning sequence: tomma block ritas utan fel', async () => {
  for (const text of [
    'sequenceDiagram\n  A->>B: 1\n  loop L\n  end',
    'sequenceDiagram\n  alt ok\n    A->>B: 1\n  else fel\n  end',
    'sequenceDiagram\n  A->>B: 0\n  alt ok\n  else fel\n    A->>B: 1\n  end',
    'sequenceDiagram\n  par a\n    A->>B: 1\n  and b\n  end',
  ]) assert.equal((await mm.render(text)).ok, true, text);
});

test('inlärning sequence: ett tomt block kraschar inte men allt efter det får koordinaten NaN', async () => {
  const ok = await mm.render('sequenceDiagram\n  A->>B: 1\n  opt O\n    A->>B: x\n  end\n  A->>B: 2');
  assert.ok(ok.seq.messageY[2] > ok.seq.messageY[0], 'med innehåll hamnar 2 under 1');
  const r = await mm.render('sequenceDiagram\n  A->>B: 1\n  opt O\n  end\n  A->>B: 2');
  assert.equal(r.ok, true);
  assert.ok(Number.isNaN(r.seq.messageY[1]), 'utan innehåll har 2 ingen position');
});

test('inlärning sequence: block ritas i den ordning de stängs, med etikett och titel', async () => {
  const r = await mm.render('sequenceDiagram\n  alt yttre\n    A->>B: 1\n    loop inre\n      B->>A: 2\n    end\n  else annars\n    A->>B: 3\n  end\n  opt sist\n    A->>B: 4\n  end');
  assert.deepEqual(r.seq.blocks.map(b => [b.label, b.title]), [['loop', '[inre]'], ['alt', '[yttre]'], ['opt', '[sist]']]);
});

test('inlärning sequence: grenarnas rubriker är sectionTitle i ordning inuti blockets ram', async () => {
  const r = await mm.render('sequenceDiagram\n  alt ett\n    A->>B: 1\n  else två\n    A->>B: 2\n  else tre\n    B->>A: 3\n  end');
  const [frame] = r.seq.blocks;
  assert.deepEqual(frame.sections.map(s => s.title), ['[två]', '[tre]']);
  assert.ok(frame.sections.every(s => frame.top < s.y && s.y < frame.bottom));
});

test('inlärning sequence: en tom gren sist hamnar utanför ramen, en tom gren i mitten går bra', async () => {
  const last = await mm.render('sequenceDiagram\n  alt ett\n    A->>B: 1\n  else två\n  end\n  A->>B: 4');
  assert.ok(last.seq.blocks[0].sections[0].y > last.seq.blocks[0].bottom, 'rubriken under ramen');
  const middle = await mm.render('sequenceDiagram\n  alt ett\n    A->>B: 1\n  else två\n  else tre\n    A->>B: 3\n  end');
  assert.ok(middle.seq.blocks[0].sections.every(s => s.y < middle.seq.blocks[0].bottom));
});

test('inlärning sequence: ett block med bara en anteckning ritar ramen runt anteckningen', async () => {
  const r = await mm.render('sequenceDiagram\n  A->>B: 1\n  loop L\n    Note over A,B: 3 messages hidden\n  end\n  A->>B: 2');
  assert.equal(r.ok, true, r.error);
  const [frame] = r.seq.blocks;
  const [note] = r.seq.noteBoxes;
  assert.ok(frame.top < note.top && note.bottom < frame.bottom, JSON.stringify({ frame, note }));
  assert.ok(r.seq.messageY[1] > frame.bottom);
});

test('inlärning sequence: rect ritas som rect.rect, inte som block, och läggs först i SVG:n när den stängs', async () => {
  const r = await mm.render('sequenceDiagram\n  rect rgb(1,2,3)\n    A->>B: 1\n    rect rgb(4,5,6)\n      A->>B: 2\n    end\n  end\n  rect rgb(7,8,9)\n    A->>B: 3\n  end');
  assert.equal(r.seq.blocks.length, 0);
  // Stängs i ordningen inre, yttre, sist; varje läggs först, så DOM-ordningen blir den omvända.
  const [last, outer, inner] = r.seq.rects;
  assert.ok(outer.top < inner.top && inner.bottom < outer.bottom, JSON.stringify(r.seq.rects));
  assert.ok(last.top > outer.bottom);
});

test('inlärning sequence: box ritas också som rect.rect, men inuti en g i stället för direkt under svg', async () => {
  const r = await mm.render('sequenceDiagram\n  box Aqua Team\n    participant X\n  end\n  rect rgb(2,2,2)\n    X->>Y: 1\n  end');
  assert.equal(r.seq.boxRects, 1);
  assert.equal(r.seq.rects.length, 1);
});

test('inlärning sequence: + aktiverar mottagaren, - avaktiverar avsändaren, obalans kraschar', async () => {
  assert.equal((await mm.render('sequenceDiagram\n  A->>+B: 1\n  B-->>-A: 2')).ok, true);
  const wrong = await mm.render('sequenceDiagram\n  A->>+B: 1\n  A-->>-B: 2');
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /inactivate an inactive participant \(A\)/);
  assert.equal((await mm.render('sequenceDiagram\n  A->>B: 1\n  deactivate B')).ok, false);
});

test('inlärning sequence: en anteckning på en okänd deltagare skapar deltagaren', async () => {
  const r = await mm.render('sequenceDiagram\n  A->>B: 1\n  Note right of C: n');
  assert.deepEqual(actors(r), ['A', 'B', 'C']);
});

test('inlärning sequence: autonumber N mitt i diagrammet startar om numreringen', async () => {
  const r = await mm.render('sequenceDiagram\n  autonumber\n  A->>B: 1\n  autonumber 5\n  B->>A: 2\n  autonumber 10 10\n  A->>B: 3\n  B->>A: 4');
  assert.deepEqual(r.seq.numbers, ['1', '5', '10', '20']);
});

test('inlärning sequence: create kräver att nästa meddelande skapar deltagaren', async () => {
  const bad = await mm.render('sequenceDiagram\n  A->>B: 1\n  create participant C\n  B->>A: annan\n  A->>C: ny');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /does not have an associated creating message/);
  assert.equal((await mm.render('sequenceDiagram\n  A->>B: 1\n  create participant C\n  A->>C: ny')).ok, true);
});

// ---------------------------------------------------------------- kontrakt: parser ⇄ Mermaid

const fs = require('node:fs');
const path = require('node:path');
const { parseSequence, filterSequence, filterSequenceDetailed } = require('../out/sequenceParser');
const { visibility, neighborhood, nodeKey, edgeKey, subgraphKey, collapseKey } = require('../out/parser');

const SAMPLES = path.join(__dirname, '..', 'samples');
const samples = fs.readdirSync(SAMPLES).filter(f => f.endsWith('.mmd'))
  .map(f => ({ name: f, text: fs.readFileSync(path.join(SAMPLES, f), 'utf8') }))
  .filter(s => parseSequence(s.text).supported);

/** Det yttersta dolda eller hopfällda blocket, eller hopfällda grenen, runt en rad, om något. */
function suppressor(model, hidden, line) {
  return [...model.blocks.values()]
    .filter(b => b.line < line && line < b.endLine && (hidden.has(collapseKey(b.id)) || (!b.section && hidden.has(subgraphKey(b.id)))))
    .sort((a, b) => a.line - b.line)[0];
}

/** Det parsern säger att Mermaid ska rita: alla synliga deltagare, synliga meddelanden med originalnummer. */
function expected(model, hidden) {
  const vis = visibility(model, hidden);
  const kept = model.edges.filter(e => !vis.isEdgeHidden(e) && !suppressor(model, hidden, e.line));
  const numbered = model.lines.filter(l => l.kind === 'msg').map(l => l.num);
  const visibleNote = (l, k) => l.kind === 'note' && !suppressor(model, hidden, k) && l.ids.some(id => !vis.isNodeHidden(id));
  // Ett hopfällt block eller en hopfälld gren får en anteckning om någon deltagare i det fortfarande syns.
  // Gren 0 börjar på samma rad som sitt block, så förälderkedjan avgör om något yttre bestämmer.
  const insideSuppressed = b => {
    for (let p = model.blocks.get(b.parent); p; p = model.blocks.get(p.parent)) {
      if (hidden.has(collapseKey(p.id)) || (!p.section && hidden.has(subgraphKey(p.id)))) return true;
    }
    return false;
  };
  const heads = [...model.blocks.values()].filter(b => hidden.has(collapseKey(b.id)) && (b.section || !hidden.has(subgraphKey(b.id)))
    && !insideSuppressed(b) && (model.edges.some(e => b.line < e.line && e.line < b.endLine && [e.from, e.to].some(id => !vis.isNodeHidden(id)))
      || model.lines.some((l, k) => l.kind === 'note' && b.line < k && k < b.endLine && l.ids.some(id => !vis.isNodeHidden(id)))));
  const notes = model.lines.filter(visibleNote).length + heads.length;
  return {
    actors: [...model.nodes.keys()].filter(id => !vis.isNodeHidden(id)).sort(),
    messages: kept.map(e => e.label),
    numbers: kept.map(e => numbered[e.index]).filter(n => n !== undefined).map(String),
    notes,
  };
}

/**
 * Kontrollerar varje fall [hidden, label]. Varje unik text renderas en gång, parallellt i
 * flikarna; sedan jämförs fallen i tur och ordning, så att första felet är det som rapporteras.
 */
async function assertAllMatch(model, cases) {
  const outs = cases.map(([hidden]) => filterSequenceDetailed(model, hidden));
  const texts = [...new Set(outs.map(o => o.text))];
  const results = await Promise.all(texts.map(t => mm.render(t)));
  const byText = new Map(texts.map((t, i) => [t, results[i]]));
  cases.forEach(([hidden, label], i) => assertMatches(model, hidden, label, outs[i], byText.get(outs[i].text)));
}

function assertMatches(model, hidden, label, out, r) {
  assert.equal(r.ok, true, `${label}: ${r.error}`);
  const want = expected(model, hidden);
  assert.deepEqual(actors(r), want.actors, `${label}: deltagare`);
  assert.deepEqual(r.seq.messages, want.messages, `${label}: meddelanden`);
  assert.deepEqual(r.seq.numbers, want.numbers, `${label}: nummer`);
  assert.equal(r.seq.notes.length, want.notes, `${label}: anteckningar`);
  // Förhandsvisningen hittar blocken via ordningen; den måste stämma med SVG:n.
  const title = id => model.blocks.get(id);
  assert.deepEqual(r.seq.blocks.map(b => [b.label, b.title]), out.blocks.map(id => [title(id).kind, `[${title(id).title}]`]), `${label}: block`);
  assert.equal(r.seq.rects.length, out.rects.length, `${label}: rect`);
  // En tom gren sist hamnar utanför ramen; alla grenrubriker ska ligga innanför.
  for (const b of r.seq.blocks) assert.ok(b.sections.every(s => b.top < s.y && s.y < b.bottom), `${label}: gren utanför ${b.label}`);
}

for (const sample of samples) {
  const model = parseSequence(sample.text);
  const nodeAndEdgeKeys = [...[...model.nodes.keys()].map(nodeKey), ...model.edges.map(e => edgeKey(e.key))];

  test(`kontrakt ${sample.name}: Mermaid ritar det parsern ser`, async () => {
    await assertAllMatch(model, [[new Set(), sample.name]]);
  });

  test(`kontrakt ${sample.name}: varje enskilt dolt element`, async () => {
    const keys = [...nodeAndEdgeKeys, ...[...model.subgraphs.keys()].map(subgraphKey)];
    await assertAllMatch(model, keys.map(key => [new Set([key]), `${sample.name} dold ${key}`]));
  });

  test(`kontrakt ${sample.name}: fokusläge för varje deltagare`, async () => {
    await assertAllMatch(model, [...model.nodes.keys()].map(id => {
      const keep = neighborhood(model, id, 1);
      return [new Set([...model.nodes.keys()].filter(n => !keep.has(n)).map(nodeKey)), `${sample.name} fokus ${id}`];
    }));
  });

  test(`kontrakt ${sample.name}: varje block hopfällt och dolt för sig`, async () => {
    await assertAllMatch(model, [...model.blocks.values()].filter(b => !b.section).flatMap(b => [
      [new Set([collapseKey(b.id)]), `${sample.name} hopfällt ${b.id}`],
      [new Set([subgraphKey(b.id)]), `${sample.name} dolt ${b.id}`],
    ]));
  });

  test(`kontrakt ${sample.name}: varje gren hopfälld för sig och med varje dold deltagare eller meddelande`, async () => {
    await assertAllMatch(model, [...model.blocks.values()].filter(b => b.section).flatMap(b => [
      [new Set([collapseKey(b.id)]), `${sample.name} hopfälld gren ${b.id}`],
      ...nodeAndEdgeKeys.map(key => [new Set([collapseKey(b.id), key]), `${sample.name} hopfälld gren ${b.id}, dold ${key}`]),
    ]));
  });

  test(`kontrakt ${sample.name}: alla block hopfällda`, async () => {
    await assertAllMatch(model, [[new Set([...model.blocks.keys()].map(collapseKey)), `${sample.name} alla hopfällda`]]);
  });

  test(`kontrakt ${sample.name}: hopfällt block tillsammans med varje dold deltagare eller meddelande`, async () => {
    await assertAllMatch(model, [...model.blocks.values()].filter(b => !b.section).flatMap(b =>
      nodeAndEdgeKeys.map(key => [new Set([collapseKey(b.id), key]), `${sample.name} hopfällt ${b.id}, dold ${key}`])));
  });

  test(`kontrakt ${sample.name}: varje par av dolda meddelanden`, async () => {
    const cases = [];
    for (let a = 0; a < model.edges.length; a++) {
      for (let b = a + 1; b < model.edges.length; b++) {
        cases.push([new Set([edgeKey(model.edges[a].key), edgeKey(model.edges[b].key)]), `${sample.name} dolda ${a},${b}`]);
      }
    }
    await assertAllMatch(model, cases);
  });
}

test('inlärning sequence: destroy kräver att nästa meddelande rör deltagaren, utom sist i diagrammet', async () => {
  const bad = await mm.render('sequenceDiagram\n  A->>B: 1\n  destroy B\n  A->>C: annan');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /does not have an associated destroying message/);
  assert.equal((await mm.render('sequenceDiagram\n  A->>B: 1\n  destroy B\n  B->>A: hejdå')).ok, true);
  assert.equal((await mm.render('sequenceDiagram\n  A->>B: 1\n  destroy B')).ok, true);
});

test('inlärning sequence: end stänger både box och block', async () => {
  const r = await mm.render('sequenceDiagram\n  box Grön Team\n    participant X\n  end\n  loop L\n    X->>Y: m\n  end');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(actors(r), ['X', 'Y']);
});
