// Kontrakt för export: förhandsvisningens SVG ska kunna sparas som en fristående SVG-fil och
// ritas om till PNG i webbläsaren. Körs med riktig Mermaid, eftersom HTML-etiketter
// (foreignObject) och länkar (xlink:href) är det som brukar göra export svår.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch } = require('./support/mermaid-browser');

const MERMAID_JS = path.join(__dirname, '..', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const EXPORT_JS = path.join(__dirname, '..', 'media', 'export.js');

let browser, page;
test.before(async () => {
  browser = await launch();
  page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><body style="background:#123456"><div id="stage" style="width:400px;height:300px"></div></body></html>');
  await page.addScriptTag({ path: MERMAID_JS });
  await page.addScriptTag({ path: EXPORT_JS });
});
test.after(async () => { await browser?.close(); });

/** Renderar som förhandsvisningen gör (inzoomad, ett markerat element) och exporterar. */
function exported(text, scale = 2) {
  return page.evaluate(async ({ text, scale }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const { svg: code } = await mermaid.render(`ex${Math.random().toString(36).slice(2)}`, text);
    const stage = document.getElementById('stage');
    stage.innerHTML = code;
    const svg = stage.querySelector('svg');
    const vb = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
    const base = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    // Som preview.js: viewBox ändras vid zoom, storleken följer scenen, och valt element markeras.
    svg.removeAttribute('style');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', `${base.x + 10} ${base.y + 10} 50 50`);
    svg.querySelector('g.node, .actor-top')?.classList.add('mm-selected');

    const file = Export.svgText(svg, base, '#123456');
    const doc = new DOMParser().parseFromString(file, 'image/svg+xml');
    const root = doc.documentElement;
    const png = await Export.pngDataUrl(file, base, scale, '#123456');
    const img = new Image();
    img.src = png;
    await img.decode();
    // Andelen pixlar som inte är bakgrundsfärgen: diagrammet ska synas, inte bara bakgrunden.
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let other = 0;
    for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - 0x12) + Math.abs(px[i + 1] - 0x34) + Math.abs(px[i + 2] - 0x56) > 30) other++;
    return {
      base,
      xmlError: doc.querySelector('parsererror')?.textContent ?? null,
      rootName: root.localName,
      ns: root.namespaceURI,
      viewBox: root.getAttribute('viewBox'),
      width: root.getAttribute('width'),
      height: root.getAttribute('height'),
      selected: file.includes('mm-selected'),
      text: root.textContent,
      png: png.slice(0, 22),
      pngSize: [img.width, img.height],
      corner: [...ctx.getImageData(0, 0, 1, 1).data],
      drawn: other / (px.length / 4),
      // Preview-SVG:n får inte ändras av exporten.
      previewViewBox: svg.getAttribute('viewBox'),
      previewSelected: !!svg.querySelector('.mm-selected'),
    };
  }, { text, scale });
}

const DIAGRAMS = {
  // HTML-etiketter med <br> och en länk (xlink:href) är de svåra fallen.
  flowchart: 'flowchart LR\n  A["Första<br>raden"] --> B{Val}\n  B -->|ja| C[Klart]\n  click C "https://example.com"',
  sequence: 'sequenceDiagram\n  actor U\n  U->>API: anropa\n  loop varje minut\n    API->>U: svar\n  end',
  class: 'classDiagram\n  class Order {\n    +int antal\n  }\n  Kund --> Order : lägger\n  link Order "https://example.com"',
  state: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy : start',
};

for (const [name, text] of Object.entries(DIAGRAMS)) {
  test(`export ${name}: fristående SVG med hela diagrammet, utan zoom och markering`, async () => {
    const r = await exported(text);
    assert.equal(r.xmlError, null, 'SVG-filen ska vara giltig XML');
    assert.equal(r.rootName, 'svg');
    assert.equal(r.ns, 'http://www.w3.org/2000/svg');
    assert.equal(r.viewBox, `${r.base.x} ${r.base.y} ${r.base.w} ${r.base.h}`);
    assert.equal(Number(r.width), r.base.w);
    assert.equal(Number(r.height), r.base.h);
    assert.equal(r.selected, false);
    assert.equal(r.previewViewBox, `${r.base.x + 10} ${r.base.y + 10} 50 50`);
    assert.equal(r.previewSelected, true);
  });

  test(`export ${name}: PNG i dubbel storlek med bakgrundsfärg och synligt diagram`, async () => {
    const r = await exported(text, 2);
    assert.equal(r.png, 'data:image/png;base64,');
    assert.deepEqual(r.pngSize, [Math.ceil(r.base.w * 2), Math.ceil(r.base.h * 2)]);
    assert.deepEqual(r.corner, [0x12, 0x34, 0x56, 255]);
    assert.ok(r.drawn > 0.01, `bara ${(r.drawn * 100).toFixed(2)} % av pixlarna är diagram`);
  });
}

test('export flowchart: etikettexten finns kvar i SVG-filen', async () => {
  const r = await exported(DIAGRAMS.flowchart);
  for (const t of ['Första', 'raden', 'Val', 'Klart', 'ja']) assert.ok(r.text.includes(t), t);
});

test('export flowchart: HTML-etiketterna ritas i PNG:n, inte bara rutorna', async () => {
  const r = await page.evaluate(async () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const { svg: code } = await mermaid.render('exLabels', 'flowchart LR\n  A["Första<br>raden med mycket text"] --> B[En annan lång etikett]');
    const stage = document.getElementById('stage');
    stage.innerHTML = code;
    const svg = stage.querySelector('svg');
    const vb = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
    const base = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    const dark = async text => {
      const img = new Image();
      img.src = await Export.pngDataUrl(text, base, 2, '#ffffff');
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] < 100) n++;
      return n;
    };
    const file = Export.svgText(svg, base, '#ffffff');
    return { labels: svg.querySelectorAll('foreignObject').length, with: await dark(file), without: await dark(file.replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, '')) };
  });
  assert.ok(r.labels > 0, 'flowchart ska ha HTML-etiketter');
  assert.ok(r.with > r.without * 1.1, `etikettexten syns inte: ${r.with} mot ${r.without} mörka pixlar`);
});
