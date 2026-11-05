// Webview-skript: renderar Mermaid och sköter zoom/panorering genom att
// ändra SVG:ns viewBox (skarpt på alla zoomnivåer).
// Fungerar även utanför VS Code (media/harness.html) för test i vanlig webbläsare.
(function () {
  'use strict';

  const vscode = typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : { postMessage: m => window.dispatchEvent(new CustomEvent('preview-out', { detail: m })) };

  const stage = document.getElementById('stage');
  const errorBox = document.getElementById('error');
  const zoomLabel = document.getElementById('zoom-level');
  const layoutSelect = document.getElementById('layout');
  const lookSelect = document.getElementById('look');

  // handDrawn-stilen ger noderna klassen rough-node i stället för node.
  const NODE_SEL = 'g.node, g.rough-node';
  // Flowchart: g.cluster med id <renderId>-<id>. State diagram: g.statediagram-cluster med nod-liknande id.
  const CLUSTER_SEL = 'g.cluster, g.statediagram-cluster';
  // Class diagram: klasser har id <renderId>-classId-<id>-<n>.
  const NODE_ID_RE = /-(?:flowchart|state|classId)-(.+)-\d+$/;
  // Sequence diagram: deltagarna överst och nederst, identifierade med name-attributet.
  const ACTOR_SEL = '.actor-top[name], .actor-bottom[name]';
  // Texten i anteckningen som ersätter innehållet i ett hopfällt block (se sequenceParser.ts).
  const PLACEHOLDER_RE = /^(\d+ messages? hidden|collapsed)$/;

  let svg = null;
  let base = null;            // diagrammets ursprungliga viewBox {x,y,w,h}
  let view = null;            // {cx, cy, s}: mittpunkt i diagramkoordinater, s = skärm-px per diagramenhet
  let selected = null;        // {kind, id}
  // Sequence: block-id:n i samma ordning som ramarna i SVG:n, och vilka som är hopfällda.
  let blocks = [];
  let rects = [];
  let sections = {};          // block-id → grenarna som ritas, i sectionTitle-ordning
  let collapsed = [];
  let lastText = '';
  let renderSeq = 0;
  let animation = 0;
  let needsFit = false;
  // Diagram som kom medan panelen var dold; ritas när den får en storlek igen.
  let pending = null;

  const size = () => ({ w: stage.clientWidth, h: stage.clientHeight });

  // ------------------------------------------------------------ koppling DOM ⇄ zoom.js

  /** Skärmpunkt relativt scenen, från klientkoordinater. */
  function local(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function apply() {
    if (!svg || !view) return;
    const b = Zoom.viewBox(view, size());
    svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
    zoomLabel.textContent = `${Math.round(view.s * 100)}%`;
  }

  /** Elementets ruta i diagramkoordinater, mätt från hur det ritas just nu. */
  function elementBox(el) {
    const r = el.getBoundingClientRect();
    const a = Zoom.toDiagram(view, size(), local(r.left, r.top));
    const b = Zoom.toDiagram(view, size(), local(r.right, r.bottom));
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  function animateTo(target, ms = 280) {
    if (!target) return;
    cancelAnimationFrame(animation);
    const from = { ...view };
    const t0 = performance.now();
    const step = now => {
      const t = (now - t0) / ms;
      view = Zoom.lerpView(from, target, Zoom.ease(t));
      apply();
      if (t < 1) animation = requestAnimationFrame(step);
    };
    animation = requestAnimationFrame(step);
  }

  const fitTo = mode => { if (view && base) animateTo(Zoom.fit(base, size(), mode)); };

  function zoomAt(factor, clientX, clientY) {
    if (!view) return;
    cancelAnimationFrame(animation);
    view = Zoom.zoomAt(view, size(), factor, local(clientX, clientY));
    apply();
  }

  function zoomCenter(factor) {
    const r = stage.getBoundingClientRect();
    zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  // ------------------------------------------------------------ element i SVG:n

  const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Block (loop, alt …) är en g med loopLine-linjer; rect-block är rect.rect direkt under svg.
  const frameEls = () => [...svg.querySelectorAll('g')].filter(g => g.querySelector(':scope > line.loopLine'));
  const rectEls = () => [...svg.children].filter(e => e.matches('rect.rect'));

  function findElement(kind, id) {
    if (!svg) return null;
    if (kind === 'node') {
      const byData = [...svg.querySelectorAll(NODE_SEL)].find(g => g.dataset.id === id);
      if (byData) return byData;
      const re = new RegExp(`-(?:flowchart|state|classId)-${reEscape(id)}-\\d+$`);
      return [...svg.querySelectorAll(NODE_SEL)].find(g => re.test(g.id))
        // Sequence: den övre rutan i första hand, den nedre om den övre saknas.
        || [...svg.querySelectorAll('.actor-top[name]')].find(a => a.getAttribute('name') === id)
        || [...svg.querySelectorAll(ACTOR_SEL)].find(a => a.getAttribute('name') === id)
        || null;
    }
    if (kind === 'block') {
      const i = blocks.indexOf(id);
      if (i >= 0) return frameEls()[i] || null;
      const j = rects.indexOf(id);
      if (j >= 0) return rectEls()[j] || null;
      // En gren: dess rubrik i blockets ram.
      for (const [block, list] of Object.entries(sections)) {
        const k = list.indexOf(id);
        const frame = k >= 0 && findElement('block', block);
        if (frame) return frame.querySelectorAll(':scope > .sectionTitle')[k] || null;
      }
      return null;
    }
    if (kind === 'edgeText') return Labels.edgeTexts(svg)[id]?.el || null;
    if (kind === 'subgraph') {
      const re = new RegExp(`-state-${reEscape(id)}-\\d+$`);
      return [...svg.querySelectorAll(CLUSTER_SEL)]
        .find(g => g.dataset.id === id || g.id === id || g.id.endsWith('-' + id) || re.test(g.id))
        // En hopfälld grupp ritas som en nod med gruppens id.
        || findElement('node', id);
    }
    return null;
  }

  /** Blocket som ett klick på en ram, en rect eller anteckningen i ett hopfällt block gäller. */
  function identifyBlock(el) {
    // Typen (alt, loop …) gäller hela blocket, titeln bredvid gäller huvudgrenen.
    const label = el.closest('.labelBox, .labelText, .loopText');
    if (label) {
      const i = frameEls().indexOf(label.parentElement);
      if (i >= 0 && blocks[i]) return { kind: 'block', id: blocks[i], toggle: true, branch: label.matches('.loopText') };
    }
    const title = el.closest('.sectionTitle');
    if (title) {
      const frame = title.parentElement;
      const block = blocks[frameEls().indexOf(frame)];
      const k = [...frame.querySelectorAll(':scope > .sectionTitle')].indexOf(title);
      const id = block && sections[block]?.[k];
      if (id) return { kind: 'block', id, toggle: true };
    }
    if (el.matches('rect.rect') && el.parentElement === svg) {
      const j = rectEls().indexOf(el);
      if (rects[j]) return { kind: 'block', id: rects[j], toggle: false };
    }
    // Anteckningen i ett hopfällt block eller en hopfälld gren: den minsta ramen som omsluter
    // anteckningen, och i den grenen vars rubrik ligger närmast ovanför.
    const g = (el.matches('rect.note') || el.closest('.noteText')) && el.closest('g');
    const note = g && g.querySelector('rect.note');
    if (note && PLACEHOLDER_RE.test(g.querySelector('.noteText')?.textContent.trim() ?? '')) {
      const n = note.getBoundingClientRect();
      const cx = n.left + n.width / 2;
      const cy = n.top + n.height / 2;
      let best = null;
      const frames = [...frameEls().map((f, i) => [blocks[i], f]), ...rectEls().map((f, i) => [rects[i], f])];
      for (const [id, frame] of frames) {
        const b = frame.getBoundingClientRect();
        if (!id || cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) continue;
        if (!best || b.width * b.height < best.area) best = { id, el: frame, area: b.width * b.height };
      }
      if (best) {
        const above = [...best.el.querySelectorAll(':scope > .sectionTitle')].filter(t => t.getBoundingClientRect().top < n.top).length;
        const main = `${best.id}:0`;
        const id = above ? sections[best.id]?.[above - 1] : collapsed.includes(main) ? main : best.id;
        if (id && collapsed.includes(id)) return { kind: 'block', id, toggle: true };
      }
    }
    return null;
  }

  function identify(el) {
    const block = identifyBlock(el);
    if (block) return block;
    // Texten på en pil (övergång, relation, meddelande); id är dess plats bland piltexterna.
    const index = Labels.edgeTextIndex(svg, el);
    if (index >= 0) return { kind: 'edgeText', id: index };
    // Sequence: deltagarens ruta har name-attributet; texten (text > tspan) ligger bredvid i samma grupp.
    const direct = `:scope > ${ACTOR_SEL.split(', ').join(', :scope > ')}`;
    let n = el;
    for (let depth = 0; n && n !== svg && depth < 4; depth++, n = n.parentElement) {
      const actor = n.matches(ACTOR_SEL) ? n : n.querySelector(direct);
      if (actor) return { kind: 'node', id: actor.getAttribute('name') };
    }
    const node = el.closest(NODE_SEL);
    if (node) {
      const id = node.dataset.id || (NODE_ID_RE.exec(node.id) || [])[1];
      if (id) return { kind: 'node', id };
    }
    const cluster = el.closest(CLUSTER_SEL);
    if (cluster) {
      const id = cluster.dataset.id || (NODE_ID_RE.exec(cluster.id) || [])[1] || cluster.id.replace(/^mmd\d+-/, '');
      if (id) return { kind: 'subgraph', id };
    }
    return null;
  }

  function highlight() {
    if (!svg) return;
    svg.querySelectorAll('.mm-selected').forEach(e => e.classList.remove('mm-selected'));
    const el = selected && findElement(selected.kind, selected.id);
    if (el) el.classList.add('mm-selected');
    return el;
  }

  function focusElement(kind, id) {
    selected = { kind, id };
    const el = highlight();
    if (!el || !view) return;
    animateTo(Zoom.focus(view, size(), elementBox(el), kind));
  }

  // ------------------------------------------------------------ zoomen behålls vid omrendering

  function captureAnchor() {
    if (!svg || !view) return null;
    const r = stage.getBoundingClientRect();
    let el = selected && findElement(selected.kind, selected.id);
    const onScreen = e => {
      const b = e.getBoundingClientRect();
      return b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
    };
    if (!el || !onScreen(el)) {
      // Ta den nod som ligger närmast mitten av vyn.
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let best = Infinity;
      el = null;
      for (const g of svg.querySelectorAll(NODE_SEL)) {
        const b = g.getBoundingClientRect();
        const d = Math.hypot(b.left + b.width / 2 - cx, b.top + b.height / 2 - cy);
        if (d < best) { best = d; el = g; }
      }
    }
    const anchor = { view: { ...view }, target: el && identify(el) };
    if (el) {
      const b = el.getBoundingClientRect();
      anchor.sx = b.left + b.width / 2 - r.left;
      anchor.sy = b.top + b.height / 2 - r.top;
    }
    return anchor;
  }

  function restoreAnchor(anchor) {
    if (!anchor) {
      // En dold panel har storleken 0; då anpassar ResizeObserver när den får en riktig storlek.
      view = Zoom.fit(base, size(), 'all');
      needsFit = !view;
      apply();
      return;
    }
    view = { ...anchor.view };
    apply();
    const el = anchor.target && findElement(anchor.target.kind, anchor.target.id);
    if (!el) return;
    view = Zoom.anchor(view, size(), elementBox(el), { x: anchor.sx, y: anchor.sy });
    apply();
  }

  // ------------------------------------------------------------ rendering

  function mermaidConfig() {
    const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
    const cfg = { startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' };
    if (layoutSelect.value) cfg.layout = layoutSelect.value;
    if (lookSelect.value) cfg.look = lookSelect.value;
    return cfg;
  }

  async function render(text) {
    lastText = text;
    // En dold panel (bakom en annan flik) har ingen storlek, och då mäter Mermaid all text
    // till 0 så att etiketterna hamnar utanför sina rutor. Vänta tills panelen syns.
    const { w, h } = size();
    if (w <= 0 || h <= 0) { pending = text; return; }
    pending = null;
    const seq = ++renderSeq;
    const id = `mmd${seq}`;
    mermaid.initialize(mermaidConfig());
    try {
      const { svg: code } = await mermaid.render(id, text);
      if (seq !== renderSeq) return; // en nyare rendering har redan startat
      const anchor = captureAnchor();
      stage.innerHTML = code;
      svg = stage.querySelector('svg');
      Labels.spread(svg, Labels.axisFor(text));
      const grown = Labels.fitClusters(svg);
      const vb = (svg.getAttribute('viewBox') || '0 0 100 100').split(/[\s,]+/).map(Number);
      base = { x: vb[0], y: vb[1], w: vb[2] || 1, h: vb[3] || 1 };
      // En grupp längst ut kan ha vuxit utanför Mermaids ram.
      if (grown) {
        const bb = svg.getBBox();
        const x = Math.min(base.x, bb.x);
        const y = Math.min(base.y, bb.y);
        base = { x, y, w: Math.max(base.x + base.w, bb.x + bb.width) - x, h: Math.max(base.y + base.h, bb.y + bb.height) - y };
      }
      svg.removeAttribute('style');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      restoreAnchor(anchor);
      highlight();
      errorBox.hidden = true;
      vscode.postMessage({ type: 'rendered' });
    } catch (err) {
      document.getElementById('d' + id)?.remove();
      if (seq !== renderSeq) return;
      errorBox.textContent = String(err && err.message || err);
      errorBox.hidden = false;
    }
  }

  // ------------------------------------------------------------ export

  /** Hela diagrammet som SVG-fil eller PNG (dubbel storlek), med förhandsvisningens bakgrund. */
  async function exportDiagram(format) {
    if (!svg || !base) return;
    try {
      const background = getComputedStyle(document.body).backgroundColor;
      const text = Export.svgText(svg, base, background);
      const data = format === 'svg' ? text : await Export.pngDataUrl(text, base, 2, background);
      vscode.postMessage({ type: 'export', format, data });
    } catch (err) {
      vscode.postMessage({ type: 'exportFailed', message: String(err && err.message || err) });
    }
  }

  // ------------------------------------------------------------ händelser

  stage.addEventListener('wheel', e => {
    if (!view) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+scroll och nyp på styrplatta (skickas som ctrl+wheel).
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX, e.clientY);
    } else {
      cancelAnimationFrame(animation);
      const k = e.deltaMode === 1 ? 16 : 1;
      view.cx += (e.shiftKey ? e.deltaY : e.deltaX) * k / view.s;
      view.cy += (e.shiftKey ? 0 : e.deltaY) * k / view.s;
      apply();
    }
  }, { passive: false });

  let drag = null;
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !view) return;
    drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) cancelAnimationFrame(animation);
    drag.moved = true;
    stage.classList.add('dragging');
    view.cx = drag.cx - dx / view.s;
    view.cy = drag.cy - dy / view.s;
    apply();
  });
  stage.addEventListener('pointerup', e => {
    const wasClick = drag && !drag.moved;
    drag = null;
    stage.classList.remove('dragging');
    if (!wasClick) return;
    // Pointer capture gör att e.target är stage, så leta upp elementet under pekaren.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const hit = under && identify(under);
    if (hit) {
      selected = { kind: hit.kind, id: hit.id };
      highlight();
      if (hit.kind === 'edgeText') vscode.postMessage({ type: 'edgeClicked', texts: Labels.edgeTexts(svg).map(t => t.text), index: hit.id });
      else vscode.postMessage({ type: 'clicked', kind: hit.kind, id: hit.id, toggle: hit.toggle === true, branch: hit.branch === true });
    }
  });

  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLSelectElement) return;
    if (e.key === '+' || e.key === '=') zoomCenter(1.25);
    else if (e.key === '-') zoomCenter(0.8);
    else if (e.key === '0') fitTo('all');
    else if (e.key === '1') fitTo('actual');
    else if (e.key === 'w') fitTo('width');
    else return;
    e.preventDefault();
  });

  new ResizeObserver(() => {
    const { w, h } = size();
    if (pending !== null && w > 0 && h > 0) { render(pending); return; }
    if (needsFit && base) { view = Zoom.fit(base, { w, h }, 'all'); needsFit = !view; }
    apply();
  }).observe(stage);

  document.getElementById('toolbar').addEventListener('click', e => {
    const action = e.target.closest('button')?.dataset.action;
    if (!action || !view) return;
    if (action === 'in') zoomCenter(1.25);
    if (action === 'out') zoomCenter(0.8);
    if (action === 'fit') fitTo('all');
    if (action === 'width') fitTo('width');
    if (action === 'actual') fitTo('actual');
    if (action === 'selection' && selected) focusElement(selected.kind, selected.id);
    if (action === 'svg' || action === 'png') exportDiagram(action);
  });
  for (const sel of [layoutSelect, lookSelect]) sel.addEventListener('change', () => render(lastText));

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'render') {
      blocks = msg.blocks || [];
      rects = msg.rects || [];
      sections = msg.sections || {};
      collapsed = msg.collapsed || [];
      render(msg.text);
    }
    if (msg.type === 'focus') focusElement(msg.kind, msg.id);
  });

  vscode.postMessage({ type: 'ready' });

  // Exponeras för test i webbläsare.
  window.__preview = { get view() { return view; }, get svg() { return svg; }, findElement, focusElement, render };
})();
