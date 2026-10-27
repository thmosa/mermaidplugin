// Kör riktiga Mermaid (samma mermaid.min.js som förhandsvisningen) i en headless-webbläsare.
// Använder installerad Chrome eller Edge via playwright-core, så ingen webbläsare laddas ner.
// Välj webbläsare med MERMAID_TEST_BROWSER=chrome|msedge.
const path = require('node:path');
const { chromium } = require('playwright-core');

const MERMAID_JS = path.join(__dirname, '..', '..', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');

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

  return { render, close: () => browser.close() };
}

module.exports = { openMermaid };
