// Ren zoom-matematik för förhandsvisningen, utan DOM. Laddas som vanligt skript
// i webviewen (window.Zoom) och med require() i testerna.
(function (root) {
  'use strict';

  const Zoom = {};

  // Vy: {cx, cy, s} där (cx, cy) är mittpunkten i diagramkoordinater och
  // s är skärmpixlar per diagramenhet. Skärmpunkter räknas från scenens hörn.

  Zoom.viewBox = (view, size) => {
    const w = size.w / view.s;
    const h = size.h / view.s;
    return { x: view.cx - w / 2, y: view.cy - h / 2, w, h };
  };

  Zoom.toDiagram = (view, size, p) => ({
    x: view.cx + (p.x - size.w / 2) / view.s,
    y: view.cy + (p.y - size.h / 2) / view.s,
  });

  Zoom.toScreen = (view, size, p) => ({
    x: (p.x - view.cx) * view.s + size.w / 2,
    y: (p.y - view.cy) * view.s + size.h / 2,
  });

  Zoom.MIN_SCALE = 0.05;
  Zoom.MAX_SCALE = 20;
  Zoom.clampScale = s => Math.min(Zoom.MAX_SCALE, Math.max(Zoom.MIN_SCALE, s));

  /** Zoomar med `factor` så att diagrampunkten under `pointer` står still på skärmen. */
  Zoom.zoomAt = (view, size, factor, pointer) => {
    const p = Zoom.toDiagram(view, size, pointer);
    const s = Zoom.clampScale(view.s * factor);
    const k = view.s / s;
    return { cx: p.x - (p.x - view.cx) * k, cy: p.y - (p.y - view.cy) * k, s };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Zoom;
  else root.Zoom = Zoom;
})(this);
