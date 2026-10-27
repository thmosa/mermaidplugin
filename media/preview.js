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

  const MIN_SCALE = 0.05;
  const MAX_SCALE = 20;
  const PAD = 24;
  // handDrawn-stilen ger noderna klassen rough-node i stället för node.
  const NODE_SEL = 'g.node, g.rough-node';

  let svg = null;
  let base = null;            // diagrammets ursprungliga viewBox {x,y,w,h}
  let view = null;            // {cx, cy, s}: mittpunkt i diagramkoordinater, s = skärm-px per diagramenhet
  let selected = null;        // {kind, id}
  let lastText = '';
  let renderSeq = 0;
  let animation = 0;
  let needsFit = false;

  const clamp = s => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  const size = () => ({ w: stage.clientWidth, h: stage.clientHeight });

  // ------------------------------------------------------------ vy-matematik

  function apply() {
    if (!svg || !view) return;
    const { w, h } = size();
    const vw = w / view.s;
    const vh = h / view.s;
    svg.setAttribute('viewBox', `${view.cx - vw / 2} ${view.cy - vh / 2} ${vw} ${vh}`);
    zoomLabel.textContent = `${Math.round(view.s * 100)} %`;
  }

  function toDiagram(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    const { w, h } = size();
    return { x: view.cx + (clientX - r.left - w / 2) / view.s, y: view.cy + (clientY - r.top - h / 2) / view.s };
  }

  function elementBox(el) {
    const r = el.getBoundingClientRect();
    const a = toDiagram(r.left, r.top);
    const b = toDiagram(r.right, r.bottom);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  function fitView(mode) {
    const { w, h } = size();
    if (mode === 'width') {
      const s = clamp((w - 2 * PAD) / base.w);
      return { cx: base.x + base.w / 2, cy: base.y + (h / 2 - PAD) / s, s };
    }
    if (mode === 'actual') return { cx: base.x + base.w / 2, cy: base.y + base.h / 2, s: 1 };
    const s = clamp(Math.min((w - 2 * PAD) / base.w, (h - 2 * PAD) / base.h));
    return { cx: base.x + base.w / 2, cy: base.y + base.h / 2, s };
  }

  function animateTo(target, ms = 280) {
    cancelAnimationFrame(animation);
    const from = { ...view };
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / ms);
      const k = 1 - Math.pow(1 - t, 3);
      view = {
        cx: from.cx + (target.cx - from.cx) * k,
        cy: from.cy + (target.cy - from.cy) * k,
        s: from.s * Math.pow(target.s / from.s, k),
      };
      apply();
      if (t < 1) animation = requestAnimationFrame(step);
    };
    animation = requestAnimationFrame(step);
  }

  function zoomAt(factor, clientX, clientY) {
    if (!view) return;
    cancelAnimationFrame(animation);
    const p = toDiagram(clientX, clientY);
    const s = clamp(view.s * factor);
    view = { cx: p.x - (p.x - view.cx) * view.s / s, cy: p.y - (p.y - view.cy) * view.s / s, s };
    apply();
  }

  function zoomCenter(factor) {
    const r = stage.getBoundingClientRect();
    zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  // ------------------------------------------------------------ element i SVG:n

  const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function findElement(kind, id) {
    if (!svg) return null;
    if (kind === 'node') {
      const byData = [...svg.querySelectorAll(NODE_SEL)].find(g => g.dataset.id === id);
      if (byData) return byData;
      const re = new RegExp(`-flowchart-${reEscape(id)}-\\d+$`);
      return [...svg.querySelectorAll(NODE_SEL)].find(g => re.test(g.id)) || null;
    }
    if (kind === 'subgraph') {
      return [...svg.querySelectorAll('g.cluster')].find(g => g.dataset.id === id || g.id === id || g.id.endsWith('-' + id)) || null;
    }
    return null;
  }

  function identify(el) {
    const node = el.closest(NODE_SEL);
    if (node) {
      const id = node.dataset.id || (/-flowchart-(.+)-\d+$/.exec(node.id) || [])[1];
      if (id) return { kind: 'node', id };
    }
    const cluster = el.closest('g.cluster');
    if (cluster) {
      const id = cluster.dataset.id || cluster.id.replace(/^mmd\d+-/, '');
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
    const box = elementBox(el);
    const { w, h } = size();
    // Noder visas i lagom storlek, subgrafer så att hela gruppen syns.
    const margin = kind === 'node' ? 5 : 1.3;
    let s = Math.min(w / (box.w * margin), h / (box.h * margin));
    if (kind === 'node') s = Math.min(Math.max(s, view.s), 2.5);
    animateTo({ cx: box.x + box.w / 2, cy: box.y + box.h / 2, s: clamp(s) });
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
      view = fitView('all');
      // En dold panel har storleken 0; anpassa igen när den får en riktig storlek.
      const { w, h } = size();
      needsFit = w === 0 || h === 0;
      apply();
      return;
    }
    view = { ...anchor.view };
    apply();
    const el = anchor.target && findElement(anchor.target.kind, anchor.target.id);
    if (!el) return;
    const box = elementBox(el);
    const { w, h } = size();
    view.cx = box.x + box.w / 2 - (anchor.sx - w / 2) / view.s;
    view.cy = box.y + box.h / 2 - (anchor.sy - h / 2) / view.s;
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
    const seq = ++renderSeq;
    const id = `mmd${seq}`;
    mermaid.initialize(mermaidConfig());
    try {
      const { svg: code } = await mermaid.render(id, text);
      if (seq !== renderSeq) return; // en nyare rendering har redan startat
      const anchor = captureAnchor();
      stage.innerHTML = code;
      svg = stage.querySelector('svg');
      const vb = (svg.getAttribute('viewBox') || '0 0 100 100').split(/[\s,]+/).map(Number);
      base = { x: vb[0], y: vb[1], w: vb[2] || 1, h: vb[3] || 1 };
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
      selected = hit;
      highlight();
      vscode.postMessage({ type: 'clicked', kind: hit.kind, id: hit.id });
    }
  });

  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLSelectElement) return;
    if (e.key === '+' || e.key === '=') zoomCenter(1.25);
    else if (e.key === '-') zoomCenter(0.8);
    else if (e.key === '0') animateTo(fitView('all'));
    else if (e.key === '1') animateTo(fitView('actual'));
    else if (e.key === 'w') animateTo(fitView('width'));
    else return;
    e.preventDefault();
  });

  new ResizeObserver(() => {
    const { w, h } = size();
    if (needsFit && base && w > 0 && h > 0) { view = fitView('all'); needsFit = false; }
    apply();
  }).observe(stage);

  document.getElementById('toolbar').addEventListener('click', e => {
    const action = e.target.closest('button')?.dataset.action;
    if (!action || !view) return;
    if (action === 'in') zoomCenter(1.25);
    if (action === 'out') zoomCenter(0.8);
    if (action === 'fit') animateTo(fitView('all'));
    if (action === 'width') animateTo(fitView('width'));
    if (action === 'actual') animateTo(fitView('actual'));
    if (action === 'selection' && selected) focusElement(selected.kind, selected.id);
  });
  for (const sel of [layoutSelect, lookSelect]) sel.addEventListener('change', () => render(lastText));

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'render') render(msg.text);
    if (msg.type === 'focus') focusElement(msg.kind, msg.id);
  });

  vscode.postMessage({ type: 'ready' });

  // Exponeras för test i webbläsare.
  window.__preview = { get view() { return view; }, get svg() { return svg; }, findElement, focusElement, fitView, render };
})();
