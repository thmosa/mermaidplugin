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
        const nodeId = new RegExp(`^${renderId}-(?:flowchart|state)-(.+)-\\d+$`);
        const all = [...doc.querySelectorAll('g.node, g.rough-node')].map(g => ({
          id: (nodeId.exec(g.id) || [])[1] ?? null,
          domId: g.id,
          dataId: g.getAttribute('data-id'),
          classes: g.getAttribute('class'),
        }));
        const isNote = n => /\bstatediagram-note\b/.test(n.classes);
        const nodes = all.filter(n => !isNote(n));
        const notes = all.filter(isNote);
        // Flowchart: g.cluster med id <renderId>-<id>. State: g.statediagram-cluster med id som noder.
        const clusters = [
          ...[...doc.querySelectorAll('g.cluster')].map(g => ({
            id: g.id.startsWith(renderId + '-') ? g.id.slice(renderId.length + 1) : g.id,
            domId: g.id,
          })),
          ...[...doc.querySelectorAll('g.statediagram-cluster')].map(g => ({ id: (nodeId.exec(g.id) || [])[1] ?? g.id, domId: g.id })),
        ];
        const paths = [...doc.querySelectorAll('g.edgePaths > path')];
        const edges = paths.filter(p => !p.id.includes('----note')).length;
        // Sequence diagram: deltagare har bara ett name-attribut, meddelanden och anteckningar är texter.
        const seq = {
          actors: [...doc.querySelectorAll('.actor-top[name]')].map(e => e.getAttribute('name')),
          messages: [...doc.querySelectorAll('.messageText')].map(e => e.textContent),
          notes: [...doc.querySelectorAll('.noteText')].map(e => e.textContent),
          numbers: [...doc.querySelectorAll('.sequenceNumber')].map(e => e.textContent),
          // Block (loop, alt …) är en g med loopLine-linjer; rect är en egen rect.rect.
          blocks: [...doc.querySelectorAll('g')].filter(g => [...g.children].some(c => c.matches('line.loopLine'))).map(g => {
            const ys = [...g.querySelectorAll(':scope > line.loopLine')].flatMap(l => [+l.getAttribute('y1'), +l.getAttribute('y2')]);
            return {
              label: g.querySelector(':scope > .labelText')?.textContent ?? null,
              // En lång titel i ett smalt block delas över flera loopText, mitt i ord med bindestreck.
              title: [...g.querySelectorAll(':scope > .loopText')].map(t => t.textContent)
                .reduce((acc, part) => acc === null ? part : acc.endsWith('-') ? acc.slice(0, -1) + part : `${acc} ${part}`, null),
              top: Math.min(...ys), bottom: Math.max(...ys),
              // Grenarnas rubriker (else, and, option) i ordning.
              sections: [...g.querySelectorAll(':scope > .sectionTitle')].map(t => ({ title: t.textContent, y: +t.getAttribute('y') })),
            };
          }),
          // Box ritas också som rect.rect men inuti en g; rect-block ligger direkt under svg.
          boxRects: doc.querySelectorAll('g > rect.rect').length,
          rects: [...doc.documentElement.children].filter(r => r.matches('rect.rect')).map(r => ({ top: +r.getAttribute('y'), bottom: +r.getAttribute('y') + +r.getAttribute('height') })),
          noteBoxes: [...doc.querySelectorAll('rect.note')].map(r => ({ top: +r.getAttribute('y'), bottom: +r.getAttribute('y') + +r.getAttribute('height') })),
          messageY: [...doc.querySelectorAll('.messageText')].map(e => +e.getAttribute('y')),
        };
        return { ok: true, error: null, renderId, nodes, notes, clusters, edges, seq };
      } catch (e) {
        document.getElementById('d' + renderId)?.remove();
        return { ok: false, error: String(e && e.message || e), renderId, nodes: [], notes: [], clusters: [], edges: 0, seq: null };
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
