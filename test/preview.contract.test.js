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
