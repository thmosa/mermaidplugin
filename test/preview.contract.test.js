// Kontrakt för förhandsvisningens sida (media/harness.html med preview.js och preview.css).
// VS Code döljer webviewen (display: none) när panelen ligger bakom en annan flik, men
// fortsätter skicka nya diagram när man döljer och visar saker i trädet.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launch } = require('./support/mermaid-browser');

const HARNESS = pathToFileURL(path.join(__dirname, '..', 'media', 'harness.html')).href;

let browser, page;
test.before(async () => {
  browser = await launch();
  page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(HARNESS);
});
test.after(async () => { await browser?.close(); });

const STATE = `stateDiagram-v2
  direction LR
  [*] --> Inaktiv
  Inaktiv --> Ansluter : starta
  state "Ansluter till server" as Ansluter
  Ansluter --> Ansluten : ok
  Ansluter --> Fel : timeout
  state Ansluten {
    [*] --> Väntar
    Väntar --> [*] : stäng
  }
  Fel --> Ansluter : retry`;

const renderedCount = () => page.evaluate(() => window.__out.filter(m => m.type === 'rendered').length);

/** Skickar ett diagram som VS Code gör, medan sidan är synlig eller dold. */
async function send(text, hidden) {
  await page.evaluate(h => { document.documentElement.style.display = h ? 'none' : ''; }, hidden);
  await page.evaluate(text => window.postMessage({ type: 'render', text }, '*'), text);
  // Låt Mermaid hinna rita om den gör det direkt.
  await page.waitForTimeout(800);
}

/** Text som inte ryms i sin ruta (foreignObject) i förhandsvisningen. */
const overflowing = () => page.evaluate(() => [...document.querySelectorAll('#stage svg foreignObject')]
  .filter(fo => fo.textContent.trim())
  .filter(fo => (fo.firstElementChild?.scrollWidth ?? 0) > fo.width.baseVal.value + 1)
  .map(fo => fo.textContent.trim()));

test('förhandsvisning: ett diagram som kommer medan panelen är dold ritas rätt när den visas', async () => {
  await send(STATE, false);
  assert.deepEqual(await overflowing(), []);
  const before = await renderedCount();
  // Som att dölja Inaktiv i trädet medan förhandsvisningen ligger bakom en annan flik.
  await send(STATE.replace('  [*] --> Inaktiv\n  Inaktiv --> Ansluter : starta\n', ''), true);
  await page.evaluate(() => { document.documentElement.style.display = ''; });
  await page.waitForFunction(n => window.__out.filter(m => m.type === 'rendered').length > n, before, { timeout: 10000 });
  assert.deepEqual(await overflowing(), []);
  const text = await page.evaluate(() => document.querySelector('#stage svg').textContent);
  assert.ok(!text.includes('starta'), 'det nya diagrammet ska visas');
  // Zoomen ska passa diagrammet, inte ha fastnat på max.
  const zoom = await page.evaluate(() => window.__preview.view.s);
  assert.ok(zoom < 5, `zoom ${zoom}`);
});

test('förhandsvisning: klick på en pils text skickar alla piltexter och vilken som klickades', async () => {
  await send(STATE, false);
  const box = await page.evaluate(() => {
    const g = [...document.querySelectorAll('#stage svg g.edgeLabel')].find(e => e.textContent.trim() === 'timeout');
    const r = g.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.evaluate(() => { window.__out.length = 0; });
  await page.mouse.click(box.x, box.y);
  const msg = await page.evaluate(() => window.__out.find(m => m.type === 'edgeClicked'));
  assert.ok(msg, 'inget edgeClicked skickades');
  assert.equal(msg.texts[msg.index], 'timeout');
  assert.deepEqual(msg.texts, ['starta', 'ok', 'timeout', 'stäng', 'retry']);
  // Texten markeras som vald.
  assert.equal(await page.evaluate(() => document.querySelector('#stage svg .mm-selected')?.textContent.trim()), 'timeout');
});

/** Fyllnadsfärgen på första nodens ruta efter att diagrammet ritats med ett tema. */
async function nodeFill(theme) {
  const before = await renderedCount();
  await page.evaluate(theme => window.postMessage({ type: 'render', text: 'flowchart LR\n  A --> B', ...theme }, '*'), theme);
  await page.waitForFunction(n => window.__out.filter(m => m.type === 'rendered').length > n, before, { timeout: 10000 });
  return page.evaluate(() => getComputedStyle(document.querySelector('#stage svg g.node rect, #stage svg g.node path')).fill);
}

test('förhandsvisning: tema och temafärger från inställningarna används, auto följer VS Code', async () => {
  const auto = await nodeFill({});
  assert.equal(await nodeFill({ theme: 'auto' }), auto);
  const forest = await nodeFill({ theme: 'forest' });
  assert.notEqual(forest, auto);
  assert.equal(await nodeFill({ theme: 'base', themeVariables: { primaryColor: '#ff0000' } }), 'rgb(255, 0, 0)');
  // Utan inställningar igen: tillbaka till VS Codes tema.
  assert.equal(await nodeFill({}), auto);
});

test('förhandsvisning: temamenyn visar inställningen, och ett val i menyn gäller tills inställningen ändras', async () => {
  const usedTheme = () => page.evaluate(() => mermaid.mermaidAPI.getConfig().theme);
  const menu = () => page.$eval('#theme', s => s.value);
  const sendTheme = async theme => {
    const before = await renderedCount();
    await page.evaluate(theme => window.postMessage({ type: 'render', text: 'flowchart LR\n  A --> B', theme }, '*'), theme);
    await page.waitForFunction(n => window.__out.filter(m => m.type === 'rendered').length > n, before, { timeout: 10000 });
  };
  await sendTheme('neo');
  assert.equal(await menu(), 'neo');
  assert.equal(await usedTheme(), 'neo');
  // Ett val i menyn ritar om med det temat.
  const before = await renderedCount();
  await page.selectOption('#theme', 'redux');
  await page.waitForFunction(n => window.__out.filter(m => m.type === 'rendered').length > n, before, { timeout: 10000 });
  assert.equal(await usedTheme(), 'redux');
  // Nästa ändring i filen har samma inställning: menyvalet står kvar.
  await sendTheme('neo');
  assert.equal(await menu(), 'redux');
  assert.equal(await usedTheme(), 'redux');
  // Inställningen ändras: menyn följer med.
  await sendTheme('forest');
  assert.equal(await menu(), 'forest');
  assert.equal(await usedTheme(), 'forest');
  await sendTheme(undefined);
  assert.equal(await menu(), 'auto');
});

/** Skickar ett diagram och väntar tills det ritats. */
async function draw(msg) {
  const before = await renderedCount();
  await page.evaluate(msg => window.postMessage({ type: 'render', ...msg }, '*'), msg);
  await page.waitForFunction(n => window.__out.filter(m => m.type === 'rendered').length > n, before, { timeout: 10000 });
}

test('förhandsvisning: en ny fil anpassas till fönstret (Fit), samma fil behåller zoomen', async () => {
  const first = 'flowchart LR\n  A --> B --> C';
  const other = 'stateDiagram-v2\n  [*] --> X\n  X --> Y : go\n  Y --> [*]';
  await draw({ text: first, fit: true });
  const fitted = await page.evaluate(() => window.__preview.view.s);
  // Zooma in, som användaren gör.
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await page.waitForTimeout(400);
  const zoomed = await page.evaluate(() => window.__preview.view.s);
  assert.ok(zoomed > fitted * 1.3, `zoom ${fitted} -> ${zoomed}`);
  // Samma fil ändras (till exempel något döljs): zoomen ligger kvar.
  await draw({ text: first + '\n  C --> D' });
  assert.ok(Math.abs(await page.evaluate(() => window.__preview.view.s) - zoomed) < 1e-6, 'zoomen ska ligga kvar');
  // Byte till en annan fil: hela diagrammet syns.
  await draw({ text: other, fit: true });
  const s = await page.evaluate(() => window.__preview.view.s);
  await page.keyboard.press('0');
  await page.waitForTimeout(400);
  assert.ok(Math.abs(await page.evaluate(() => window.__preview.view.s) - s) < 1e-3, 'ska vara som Fit');
});

// ---- markeringen: bara det som faktiskt är valt ska lysa, aldrig något annat efter att något döljs

const highlighted = () => page.evaluate(() => [...document.querySelectorAll('#stage svg .mm-selected')].map(e => e.textContent.trim()));

async function clickEdgeText(text) {
  const box = await page.evaluate(text => {
    const g = [...document.querySelectorAll('#stage svg g.edgeLabel')].find(e => e.textContent.trim() === text);
    const r = g.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, text);
  await page.mouse.click(box.x, box.y);
}

const FLOW = 'flowchart LR\n  A -->|ett| B\n  B -->|två| C\n  C -->|tre| D';

test('markering: en vald piltext som döljs lämnar ingen markering på nästa pil', async () => {
  await draw({ text: FLOW, fit: true });
  await clickEdgeText('två');
  assert.deepEqual(await highlighted(), ['två']);
  await draw({ text: 'flowchart LR\n  A -->|ett| B\n  C -->|tre| D\n  B\n  C' });
  assert.deepEqual(await highlighted(), []);
});

test('markering: när något före den valda piltexten döljs lyser ingen annan pil', async () => {
  await draw({ text: FLOW, fit: true });
  await clickEdgeText('två');
  await draw({ text: 'flowchart LR\n  B -->|två| C\n  C -->|tre| D' });
  assert.ok(!(await highlighted()).includes('tre'));
});

test('markering: piltexten är kvar när diagrammet ritas om med samma piltexter', async () => {
  await draw({ text: FLOW, fit: true });
  await clickEdgeText('två');
  await draw({ text: `${FLOW}\n  D --> E` });
  assert.deepEqual(await highlighted(), ['två']);
});

test('markering: en vald nod som döljs lämnar ingen markering', async () => {
  await draw({ text: 'flowchart LR\n  A --> B\n  B --> C', fit: true });
  await page.evaluate(() => window.postMessage({ type: 'focus', kind: 'node', id: 'B' }, '*'));
  await page.waitForFunction(() => document.querySelector('#stage svg .mm-selected'));
  await draw({ text: 'flowchart LR\n  A\n  C' });
  assert.deepEqual(await highlighted(), []);
});

test('markering: en dold grupp förväxlas inte med en grupp vars id slutar likadant', async () => {
  await draw({ text: 'flowchart LR\n  subgraph Bar-Foo\n    A\n  end\n  subgraph Foo\n    B\n  end', fit: true });
  await draw({ text: 'flowchart LR\n  subgraph Bar-Foo\n    A\n  end\n  B' });
  await page.evaluate(() => window.postMessage({ type: 'focus', kind: 'subgraph', id: 'Foo' }, '*'));
  await page.waitForTimeout(200);
  assert.deepEqual(await highlighted(), []);
});

test('markering: att välja något dolt i trädet tar bort den gamla markeringen', async () => {
  await draw({ text: 'flowchart LR\n  A --> B', fit: true });
  await page.evaluate(() => window.postMessage({ type: 'focus', kind: 'node', id: 'A' }, '*'));
  await page.waitForFunction(() => document.querySelector('#stage svg .mm-selected'));
  await page.evaluate(() => window.postMessage({ type: 'focus', kind: 'node', id: 'Finnsinte' }, '*'));
  await page.waitForFunction(() => !document.querySelector('#stage svg .mm-selected'));
  // En pil i trädet har ingen egen markering i bilden.
  await page.evaluate(() => window.postMessage({ type: 'focus', kind: 'node', id: 'A' }, '*'));
  await page.waitForFunction(() => document.querySelector('#stage svg .mm-selected'));
  await page.evaluate(() => window.postMessage({ type: 'clearSelection' }, '*'));
  await page.waitForFunction(() => !document.querySelector('#stage svg .mm-selected'), null, { timeout: 2000 });
});

test('markering: varje grupp i exemplen hittas med sitt id', async () => {
  const fs = require('node:fs');
  for (const file of ['class.mmd', 'demo.mmd', 'state.mmd']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'samples', file), 'utf8');
    await draw({ text, fit: true });
    const { parseDiagram } = require('../out/diagram');
    for (const id of parseDiagram(text).subgraphs.keys()) {
      assert.ok(await page.evaluate(id => !!window.__preview.findElement('subgraph', id), id), `${file}: ${id}`);
    }
  }
});

// ---- Show in Diagram: VS Code säger vilken piltext som ska visas

test('Show in Diagram: varje pil med text i exemplen hittar sin egen text i bilden', async () => {
  const fs = require('node:fs');
  const { parseDiagram } = require('../out/diagram');
  const { resolveTarget } = require('../out/showInDiagram');
  const { edgeAtClick } = require('../out/edgeClick');
  for (const file of ['Test.mmd', 'class.mmd', 'demo.mmd', 'manufacturing.mmd', 'sequence.mmd', 'state.mmd']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'samples', file), 'utf8');
    const model = parseDiagram(text);
    await draw({ text, fit: true });
    const none = new Set();
    let shown = 0;
    for (const edge of model.edges) {
      const target = resolveTarget(model, none, { kind: 'edge', edge });
      if (target.kind !== 'edgeText') continue;
      const hit = await page.evaluate(msg => new Promise(done => {
        window.postMessage({ type: 'focusEdge', ...msg }, '*');
        setTimeout(() => {
          const texts = Labels.edgeTexts(window.__preview.svg);
          done({ texts: texts.map(t => t.text), index: texts.findIndex(t => t.el.classList.contains('mm-selected')) });
        }, 30);
      }), target);
      assert.ok(hit.index >= 0, `${file}: ${edge.key} markerades inte`);
      assert.equal(edgeAtClick(model, none, hit.texts, hit.index)?.key, edge.key, file);
      shown++;
    }
    assert.ok(shown > 0, `${file}: inga pilar med text`);
  }
});

test('Show in Diagram: en piltext zoomas som en nod, inte till hela fönstret', async () => {
  await draw({ text: FLOW, fit: true });
  await page.evaluate(() => window.postMessage({ type: 'focusEdge', text: 'två', nth: 0 }, '*'));
  await page.waitForTimeout(600);
  assert.deepEqual(await highlighted(), ['två']);
  assert.ok(await page.evaluate(() => window.__preview.view.s <= Math.max(Zoom.NODE_FOCUS_MAX, 1) + 1e-6));
});

// ------------------------------------------------------------ knapp för att fälla ihop och ut i bilden

/** Skickar ett render-meddelande som VS Code gör och väntar tills det är ritat. */
async function sendRender(msg) {
  const before = await renderedCount();
  await page.evaluate(m => window.postMessage({ type: 'render', ...m }, '*'), msg);
  await page.waitForFunction(n => window.__out.filter(m => m.type === 'rendered').length > n, before, { timeout: 10000 });
}

/** Knappen för gruppen: om den finns, vad den visar och om den ligger i gruppens övre högra hörn. */
const toggleInfo = id => page.evaluate(id => {
  const btn = [...document.querySelectorAll('#stage svg .mm-toggle')].find(b => b.dataset.id === id);
  if (!btn) return null;
  const owner = window.__preview.findElement('subgraph', id);
  const b = btn.getBoundingClientRect();
  const o = owner.getBoundingClientRect();
  return {
    inside: owner.contains(btn),
    collapsed: btn.dataset.collapsed,
    symbol: btn.querySelector('.mm-toggle-collapse') ? 'collapse' : btn.querySelector('.mm-toggle-expand') ? 'expand' : null,
    title: btn.querySelector('title')?.textContent,
    // Avstånd från gruppens högra och övre kant, i skärmpixlar.
    right: o.right - b.right, top: b.top - o.top, size: b.width,
  };
}, id);

test('knapp i bilden: en sammansatt state har en minimeringsknapp i sitt övre högra hörn', async () => {
  await sendRender({ text: STATE, toggles: [{ id: 'Ansluten', collapsed: false }], collapsible: 1, fit: true });
  const info = await toggleInfo('Ansluten');
  assert.ok(info, 'ingen knapp');
  assert.equal(info.inside, true);
  assert.equal(info.collapsed, 'false');
  assert.equal(info.symbol, 'collapse');
  assert.equal(info.title, 'Collapse');
  assert.ok(info.right >= 0 && info.right < 20 && info.top >= 0 && info.top < 20, JSON.stringify(info));
});

test('knapp i bilden: en hopfälld grupp ritas som en ruta med maximeringsknapp', async () => {
  const { parseDiagram, filterDiagram } = require('../out/diagram');
  const text = filterDiagram(parseDiagram(STATE), new Set(['c:Ansluten']));
  await sendRender({ text, toggles: [{ id: 'Ansluten', collapsed: true }], collapsible: 1, fit: true });
  const info = await toggleInfo('Ansluten');
  assert.ok(info, 'ingen knapp');
  assert.equal(info.collapsed, 'true');
  assert.equal(info.symbol, 'expand');
  assert.equal(info.title, 'Expand');
});

test('knapp i bilden: subgrafer i flowchart och namespaces i class diagram får knappen', async () => {
  const flow = 'flowchart LR\n  subgraph S [Grupp]\n    a --> b\n  end\n  b --> c';
  await sendRender({ text: flow, toggles: [{ id: 'S', collapsed: false }], collapsible: 1, fit: true });
  assert.equal((await toggleInfo('S'))?.symbol, 'collapse', 'flowchart');
  const cls = 'classDiagram\n  namespace Shop {\n    class Order\n    class Rad\n  }\n  Order --> Kund';
  await sendRender({ text: cls, toggles: [{ id: 'Shop', collapsed: false }], collapsible: 1, fit: true });
  assert.equal((await toggleInfo('Shop'))?.symbol, 'collapse', 'class diagram');
});

test('knapp i bilden: klick på knappen fäller ihop gruppen, inte markerar den', async () => {
  await sendRender({ text: STATE, toggles: [{ id: 'Ansluten', collapsed: false }], collapsible: 1, fit: true });
  const at = await page.evaluate(() => {
    const r = document.querySelector('#stage svg .mm-toggle').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.evaluate(() => { window.__out.length = 0; });
  await page.mouse.click(at.x, at.y);
  const out = await page.evaluate(() => window.__out.filter(m => m.type !== 'rendered'));
  assert.deepEqual(out, [{ type: 'toggleGroup', id: 'Ansluten' }]);
});

test('knapp i bilden: knappen följer inte med i exporten', async () => {
  await sendRender({ text: STATE, toggles: [{ id: 'Ansluten', collapsed: false }], collapsible: 1, fit: true });
  await page.evaluate(() => { window.__out.length = 0; });
  await page.click('button[data-action="svg"]');
  await page.waitForFunction(() => window.__out.some(m => m.type === 'export'), null, { timeout: 10000 });
  const data = await page.evaluate(() => window.__out.find(m => m.type === 'export').data);
  assert.ok(data.includes('Ansluten'), 'exporten saknar diagrammet');
  assert.ok(!data.includes('mm-toggle'), 'knappen följde med i exporten');
});

test('högerklick i bilden: menyn vet om diagrammet har grupper, och VS Codes Kopiera/Klistra in visas inte', async () => {
  await sendRender({ text: STATE, toggles: [{ id: 'Ansluten', collapsed: false }], collapsible: 1, fit: true });
  let ctx = await page.evaluate(() => JSON.parse(document.getElementById('stage').dataset.vscodeContext));
  assert.deepEqual(ctx, { preventDefaultContextMenuItems: true, mermaidTreeGroups: true });
  await sendRender({ text: 'flowchart LR\n  a --> b', toggles: [], collapsible: 0, fit: true });
  ctx = await page.evaluate(() => JSON.parse(document.getElementById('stage').dataset.vscodeContext));
  assert.deepEqual(ctx, { preventDefaultContextMenuItems: true, mermaidTreeGroups: false });
});

test('knapp i bilden: Mermaids färger för noder och kluster tar inte över knappens symboler', async () => {
  const { parseDiagram, filterDiagram } = require('../out/diagram');
  const { groupToggles } = require('../out/tree');
  const model = parseDiagram('flowchart LR\n  subgraph S [S]\n    a\n  end\n  subgraph T [T]\n    c\n  end\n  a --> c');
  const hidden = new Set(['c:T']);
  await sendRender({ text: filterDiagram(model, hidden), toggles: groupToggles(model, hidden), collapsible: 2, fit: true });
  const strokes = await page.evaluate(() => ['.mm-toggle-collapse', '.mm-toggle-expand']
    .map(sel => getComputedStyle(document.querySelector(`#stage svg ${sel}`)).stroke));
  assert.equal(strokes[1], strokes[0], `minimera ${strokes[0]}, maximera ${strokes[1]}`);
});

test('fokus på grupp: varje synlig state ritas inuti sin grupp (LargeState, state.mmd)', async () => {
  const fs = require('node:fs');
  const { parseDiagram, filterDiagram } = require('../out/diagram');
  const { groupNeighborhood, nodeKey, visibility } = require('../out/parser');
  const wrong = [];
  for (const file of ['LargeState.mmd', 'state.mmd']) {
    const model = parseDiagram(fs.readFileSync(path.join(__dirname, '..', 'samples', file), 'utf8'));
    for (const sg of model.subgraphs.keys()) {
      const keep = groupNeighborhood(model, sg);
      const hidden = new Set([...model.nodes.keys()].filter(n => !keep.has(n)).map(nodeKey));
      await sendRender({ text: filterDiagram(model, hidden), fit: true });
      const vis = visibility(model, hidden);
      const pairs = [...model.nodes.values()].filter(n => n.subgraph && !n.pseudo && !vis.isNodeHidden(n.id)).map(n => [n.id, n.subgraph]);
      const outside = await page.evaluate(pairs => pairs.filter(([id, sg]) => {
        const n = window.__preview.findElement('node', id)?.getBoundingClientRect();
        const c = window.__preview.findElement('subgraph', sg)?.getBoundingClientRect();
        return !n || !c || n.left < c.left || n.right > c.right || n.top < c.top || n.bottom > c.bottom;
      }).map(([id, sg]) => `${id} utanför ${sg}`), pairs);
      wrong.push(...outside.map(s => `${file} fokus ${sg}: ${s}`));
    }
  }
  assert.deepEqual(wrong, []);
});

test('Focus: varje synlig state ritas inuti sin grupp när fokus börjar i en grupp (LargeState)', async () => {
  const fs = require('node:fs');
  const { parseDiagram, filterDiagram } = require('../out/diagram');
  const { nodeKey, visibility } = require('../out/parser');
  const { chain } = require('../out/chain');
  const model = parseDiagram(fs.readFileSync(path.join(__dirname, '..', 'samples', 'LargeState.mmd'), 'utf8'));
  const wrong = [];
  for (const sg of model.subgraphs.keys()) {
    const keep = chain(model, { kind: 'subgraph', id: sg }, 'both', Infinity);
    const hidden = new Set([...model.nodes.keys()].filter(n => !keep.has(n)).map(nodeKey));
    await sendRender({ text: filterDiagram(model, hidden), fit: true });
    const vis = visibility(model, hidden);
    const pairs = [...model.nodes.values()].filter(n => n.subgraph && !n.pseudo && !vis.isNodeHidden(n.id)).map(n => [n.id, n.subgraph]);
    const outside = await page.evaluate(pairs => pairs.filter(([id, g]) => {
      const n = window.__preview.findElement('node', id)?.getBoundingClientRect();
      const c = window.__preview.findElement('subgraph', g)?.getBoundingClientRect();
      return !n || !c || n.left < c.left || n.right > c.right || n.top < c.top || n.bottom > c.bottom;
    }).map(([id, g]) => `${id} utanför ${g}`), pairs);
    wrong.push(...outside.map(s => `kedja från ${sg}: ${s}`));
  }
  assert.deepEqual(wrong, []);
});

// ------------------------------------------------------------ fokus flyttar vyn till det som syns kvar

test('fokus: vyn visar det som är kvar och markerar elementet, även när fokus kommer medan bilden ritas om', async () => {
  const fs = require('node:fs');
  const { parseDiagram, filterDiagram } = require('../out/diagram');
  const { nodeKey } = require('../out/parser');
  const { chain } = require('../out/chain');
  const model = parseDiagram(fs.readFileSync(path.join(__dirname, '..', 'samples', 'LargeState.mmd'), 'utf8'));
  await sendRender({ text: filterDiagram(model, new Set()), fit: true });
  // Zooma in långt bort från W10, som man gör innan man fokuserar.
  await page.evaluate(() => window.__preview.focusElement('node', 'W1_F1'));
  await page.waitForTimeout(500);
  const keep = chain(model, { kind: 'node', id: 'W10_F3' }, 'both', 1);
  const text = filterDiagram(model, new Set([...model.nodes.keys()].filter(n => !keep.has(n)).map(nodeKey)));
  // Som VS Code: nytt diagram och fokus direkt efter, utan att vänta på att bilden är klar.
  const before = await renderedCount();
  await page.evaluate(text => {
    window.postMessage({ type: 'render', text }, '*');
    window.postMessage({ type: 'focus', kind: 'node', id: 'W10_F3', fit: true }, '*');
  }, text);
  await page.waitForFunction(n => window.__out.filter(m => m.type === 'rendered').length > n, before, { timeout: 10000 });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const inside = b => b.left >= stage.left - 1 && b.right <= stage.right + 1 && b.top >= stage.top - 1 && b.bottom <= stage.bottom + 1;
    const sel = document.querySelector('#stage svg .mm-selected');
    return {
      selected: sel ? window.__preview.findElement('node', 'W10_F3') === sel : false,
      allVisible: [...document.querySelectorAll('#stage svg g.node')].every(g => inside(g.getBoundingClientRect())),
    };
  });
  assert.deepEqual(r, { selected: true, allVisible: true });
});
