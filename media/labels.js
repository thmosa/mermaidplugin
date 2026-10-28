// Flyttar isär kantetiketter som Mermaid ritat ovanpå varandra (händer med ELK när
// flera kanter in i samma nod korsar en subgrafgräns). Laddas som vanligt skript i
// webviewen (window.Labels) och med require() i testerna.
(function (root) {
  'use strict';

  const Labels = {};

  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  /**
   * Förskjutningar {dx, dy} som gör att rutorna {x, y, w, h} inte överlappar.
   * Överlappande rutor staplas längs `axis` ('y' lodrätt, 'x' vågrätt) runt sin
   * ursprungliga gemensamma mitt, i samma ordning som förut, med `gap` emellan.
   *
   * Grupper slås bara ihop, aldrig isär, så det tar högst n - 1 varv. En stapel
   * kan inte överlappa sig själv, så när inga grupper krockar är allt fritt.
   */
  Labels.separate = (boxes, opts = {}) => {
    const axis = opts.axis === 'x' ? 'x' : 'y';
    const size = axis === 'x' ? 'w' : 'h';
    const gap = opts.gap ?? 4;
    const center = b => b[axis] + b[size] / 2;
    const pos = boxes.map(b => ({ ...b }));
    const group = boxes.map((_, i) => i);

    const stack = g => {
      const members = boxes.map((_, i) => i).filter(i => group[i] === g);
      members.sort((a, b) => center(boxes[a]) - center(boxes[b]) || a - b);
      const mid = members.reduce((sum, i) => sum + center(boxes[i]), 0) / members.length;
      const total = members.reduce((sum, i) => sum + boxes[i][size], 0) + gap * (members.length - 1);
      let at = mid - total / 2;
      for (const i of members) { pos[i][axis] = at; at += boxes[i][size] + gap; }
    };

    for (;;) {
      let hit = null;
      for (let i = 0; i < pos.length && !hit; i++) {
        for (let j = i + 1; j < pos.length; j++) if (overlaps(pos[i], pos[j])) { hit = [i, j]; break; }
      }
      if (!hit) break;
      const [keep, gone] = [group[hit[0]], group[hit[1]]];
      for (let i = 0; i < group.length; i++) if (group[i] === gone) group[i] = keep;
      stack(keep);
    }
    return boxes.map((b, i) => ({ dx: pos[i].x - b.x, dy: pos[i].y - b.y }));
  };

  /** Staplingsaxel efter diagrammets riktning: lodrätt för LR/RL, annars vågrätt. */
  Labels.axisFor = text => {
    const m = /^\s*(?:flowchart|graph)\b[ \t]*(\w+)?/m.exec(text)
      || (/^\s*stateDiagram/m.test(text) && /^\s*direction[ \t]+(\w+)/m.exec(text));
    return m && /^(LR|RL)$/i.test(m[1] || '') ? 'y' : 'x';
  };

  /** Flyttar isär kantetiketterna i en ritad SVG. Kräver DOM (webviewen). */
  Labels.spread = (svg, axis) => {
    const items = [];
    for (const g of svg.querySelectorAll('g.edgeLabel')) {
      const bb = g.getBBox();
      if (!bb.width || !bb.height || !g.textContent.trim()) continue;
      const m = g.transform.baseVal.consolidate()?.matrix;
      const tx = m ? m.e : 0;
      const ty = m ? m.f : 0;
      items.push({ g, m, box: { x: tx + bb.x, y: ty + bb.y, w: bb.width, h: bb.height } });
    }
    const offsets = Labels.separate(items.map(it => it.box), { axis });
    items.forEach(({ g, m }, i) => {
      const { dx, dy } = offsets[i];
      if (!dx && !dy) return;
      g.setAttribute('transform', m
        ? `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e + dx} ${m.f + dy})`
        : `translate(${dx} ${dy})`);
    });
    return offsets.filter(o => o.dx || o.dy).length;
  };

  if (typeof module === 'object' && module.exports) module.exports = Labels;
  else root.Labels = Labels;
})(typeof self !== 'undefined' ? self : this);
