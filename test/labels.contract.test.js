// Kontrakt för kantetiketter mot riktiga Mermaid. Mermaid räknar ut storleken på ett
// sammansatt tillstånd utan etikettens utfyllnad, så en bred etikett vid kanten sticker ut
// (se samples/LargeState.mmd, W4). Labels.fitClusters gör gruppen större i stället, så att
// etiketterna ligger kvar på sina pilar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./support/mermaid-browser');

const MERMAID_JS = path.join(__dirname, '..', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const LABELS_JS = path.join(__dirname, '..', 'media', 'labels.js');
const LARGE = fs.readFileSync(path.join(__dirname, '..', 'samples', 'LargeState.mmd'), 'utf8');

let browser, page;
test.before(async () => {
  browser = await launch();
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.setContent('<div id="s"></div>');
  await page.addScriptTag({ path: MERMAID_JS });
  await page.addScriptTag({ path: LABELS_JS });
});
test.after(async () => { await browser?.close(); });

/** Renderar och beskriver etiketterna: vilka som sticker ut ur sin grupp och vilka som lämnat sin pil. */
function labels(text, fix) {
  return page.evaluate(async ({ text, fix }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const { svg } = await mermaid.render(`lc${Math.random().toString(36).slice(2)}`, text);
    s.innerHTML = svg;
    const el = s.querySelector('svg');
    if (fix) Labels.spread(el, Labels.axisFor(text));
    const moved = fix ? Labels.fitClusters(el) : 0;
    const labelBoxes = [...el.querySelectorAll('g.edgeLabel')].filter(g => g.textContent.trim())
      .map(g => { const r = g.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
    const clusters = [...el.querySelectorAll('g.cluster, g.statediagram-cluster')]
      .map(g => ({ id: g.id, r: g.getBoundingClientRect() }));
    const outside = [];
    const offArrow = [];
    for (const g of el.querySelectorAll('g.edgeLabel')) {
      const t = g.textContent.trim();
      if (!t) continue;
      const r = g.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const own = clusters.filter(c => cx > c.r.left && cx < c.r.right && cy > c.r.top && cy < c.r.bottom)
        .sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height)[0];
      if (own && (r.left < own.r.left - 0.5 || r.right > own.r.right + 0.5 || r.top < own.r.top - 0.5 || r.bottom > own.r.bottom + 0.5)) outside.push(t);
      // Etiketten ska fortfarande ligga över sin egen pil.
      const pid = g.querySelector('[data-id]')?.getAttribute('data-id');
      const path = pid && el.querySelector(`g.edgePaths > path[data-id="${pid}"], g.edgePaths > path[id="${pid}"]`);
      if (path) {
        const m = path.getScreenCTM();
        let hit = false;
        for (let d = 0, len = path.getTotalLength(); d <= len && !hit; d += 2) {
          const p = path.getPointAtLength(d).matrixTransform(m);
          hit = p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
        }
        if (!hit) offArrow.push(t);
      }
    }
    // Etiketter som ligger ovanpå varandra.
    const boxes = [...el.querySelectorAll('g.edgeLabel')].filter(g => g.textContent.trim()).map(g => [g.textContent.trim(), g.getBoundingClientRect()]);
    const overlapping = [];
    boxes.forEach(([ta, a], i) => boxes.slice(i + 1).forEach(([tb, b]) => {
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlapping.push(`${ta} / ${tb}`);
    }));
    // Grupper (utom nästlade) som går in i varandra.
    const touching = [];
    clusters.forEach((a, i) => clusters.slice(i + 1).forEach(b => {
      const nested = (x, y) => x.r.left <= y.r.left && x.r.right >= y.r.right && x.r.top <= y.r.top && x.r.bottom >= y.r.bottom;
      if (!nested(a, b) && !nested(b, a) && a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom) touching.push(`${a.id} / ${b.id}`);
    }));
    // Gruppens rubrik ska ligga mitt på gruppen även när den har vuxit.
    const offCenter = [...el.querySelectorAll('g.cluster, g.statediagram-cluster')].flatMap(g => {
      const title = g.querySelector(':scope > g.cluster-label');
      if (!title || !title.textContent.trim()) return [];
      const a = g.getBoundingClientRect();
      const b = title.getBoundingClientRect();
      const off = Math.abs(a.left + a.width / 2 - (b.left + b.width / 2));
      return off > 1 ? [`${title.textContent.trim()} ${Math.round(off)}px`] : [];
    });
    return { moved, outside, offArrow, overlapping, touching, labelBoxes, offCenter };
  }, { text, fix });
}

test('kontrakt: Mermaid låter breda etiketter sticka ut ur sitt sammansatta tillstånd', async () => {
  const r = await labels(LARGE, false);
  assert.ok(r.outside.includes('return label created and attached to original order for reverse logistics'), r.outside.join(', '));
});

test('etiketter: fitClusters gör grupperna stora nog, utan att flytta etiketterna', async () => {
  const before = await labels(LARGE, false);
  const r = await labels(LARGE, true);
  assert.deepEqual(r.outside, []);
  assert.ok(r.moved > 0);
  assert.deepEqual(r.touching, [], 'grupperna får inte växa in i varandra');
  assert.deepEqual(r.offArrow, before.offArrow, 'inga nya etiketter får hamna bredvid sin pil');
  assert.deepEqual(r.overlapping, []);
  assert.deepEqual(r.offCenter, [], 'rubriken ska stå mitt på gruppen');
});

test('etiketter: fitClusters rör inget när allt redan ryms', async () => {
  const r = await labels('flowchart LR\n  subgraph G\n    A -->|kort| B\n  end', true);
  assert.equal(r.moved, 0);
});
