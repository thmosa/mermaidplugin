// Kör riktiga Mermaid (samma mermaid.min.js som förhandsvisningen) i en headless-webbläsare.
// Använder installerad Chrome eller Edge via playwright-core, så ingen webbläsare laddas ner.
// Välj webbläsare med MERMAID_TEST_BROWSER=chrome|msedge.
const path = require('node:path');
const { chromium } = require('playwright-core');

const MERMAID_JS = path.join(__dirname, '..', '..', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const LABELS_JS = path.join(__dirname, '..', '..', 'media', 'labels.js');

async function launch() {
  const channels = process.env.MERMAID_TEST_BROWSER ? [process.env.MERMAID_TEST_BROWSER] : ['chrome', 'msedge'];
  const errors = [];
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (e) {
      errors.push(`${channel}: ${String(e.message).split('\n')[0]}`);
    }
  }
  throw new Error(`Hittade ingen webbläsare för kontraktstesterna (installera Chrome eller Edge).\n${errors.join('\n')}`);
}

/** Startar webbläsaren och returnerar { render, close }. */
async function openMermaid() {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><body></body></html>');
  await page.addScriptTag({ path: MERMAID_JS });
  let seq = 0;

  /**
   * Renderar text och beskriver resultatet:
   * { ok, error, renderId, nodes: [{id, domId, dataId, classes}], clusters: [{id, domId}], edges }
   */
  async function render(text, config = {}) {
    const renderId = `mm${++seq}`;
    return page.evaluate(async ({ text, config, renderId }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', ...config });
      try {
        const { svg } = await mermaid.render(renderId, text);
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const nodes = [...doc.querySelectorAll('g.node, g.rough-node')].map(g => ({
          id: (new RegExp(`^${renderId}-flowchart-(.+)-\\d+$`).exec(g.id) || [])[1] ?? null,
          domId: g.id,
          dataId: g.getAttribute('data-id'),
          classes: g.getAttribute('class'),
        }));
        const clusters = [...doc.querySelectorAll('g.cluster')].map(g => ({
          id: g.id.startsWith(renderId + '-') ? g.id.slice(renderId.length + 1) : g.id,
          domId: g.id,
        }));
        const edges = doc.querySelectorAll('g.edgePaths > path').length;
        return { ok: true, error: null, renderId, nodes, clusters, edges };
      } catch (e) {
        document.getElementById('d' + renderId)?.remove();
        return { ok: false, error: String(e && e.message || e), renderId, nodes: [], clusters: [], edges: 0 };
      }
    }, { text, config, renderId });
  }

  await page.addScriptTag({ path: LABELS_JS });

  /**
   * Ritar text i DOM:en och räknar par av kantetiketter som överlappar,
   * före och efter Labels.spread: { ok, error, labels, before, after }.
   */
  async function labelOverlaps(text, config = {}) {
    const renderId = `mm${++seq}`;
    return page.evaluate(async ({ text, config, renderId }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', ...config });
      const count = svg => {
        const b = [...svg.querySelectorAll('g.edgeLabel')]
          .filter(g => g.textContent.trim()).map(g => g.getBoundingClientRect()).filter(r => r.width > 0);
        let n = 0;
        for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++)
          if (b[i].left < b[j].right && b[j].left < b[i].right && b[i].top < b[j].bottom && b[j].top < b[i].bottom) n++;
        return { labels: b.length, n };
      };
      try {
        const { svg } = await mermaid.render(renderId, text);
        const host = document.createElement('div');
        host.innerHTML = svg;
        document.body.append(host);
        const el = host.querySelector('svg');
        const before = count(el);
        Labels.spread(el, Labels.axisFor(text));
        const after = count(el);
        host.remove();
        return { ok: true, error: null, labels: before.labels, before: before.n, after: after.n };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e), labels: 0, before: 0, after: 0 };
      }
    }, { text, config, renderId });
  }

  return { render, labelOverlaps, close: () => browser.close() };
}

module.exports = { openMermaid };
