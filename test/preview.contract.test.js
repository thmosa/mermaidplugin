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
