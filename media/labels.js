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

  /**
   * Hur mycket gruppen `box` behöver växa åt varje håll för att rymma etikettrutorna
   * `labels` med `margin` till kanten.
   */
  Labels.growth = (box, labels, margin = 4) => {
    const g = { left: 0, right: 0, top: 0, bottom: 0 };
    for (const l of labels) {
      g.left = Math.max(g.left, box.x + margin - l.x);
      g.right = Math.max(g.right, l.x + l.w + margin - (box.x + box.w));
      g.top = Math.max(g.top, box.y + margin - l.y);
      g.bottom = Math.max(g.bottom, l.y + l.h + margin - (box.y + box.h));
    }
    return g;
  };

  /**
   * Mermaid räknar ut storleken på en grupp (subgraf, sammansatt tillstånd) utan kantetikettens
   * utfyllnad, så en bred etikett vid kanten sticker ut. Gör gruppens rutor större så att de
   * etiketter vars mitt ligger i gruppen ryms; etiketterna och pilarna flyttas inte.
   * Ger antalet grupper som växte. Kräver DOM (webviewen).
   */
  Labels.fitClusters = (svg, margin = 4) => {
    const scale = (svg.getScreenCTM() || { a: 1 }).a;
    const toBox = r => ({ x: r.left, y: r.top, w: r.width, h: r.height });
    const clusters = [...svg.querySelectorAll('g.cluster, g.statediagram-cluster')]
      .map(g => ({ g, box: toBox(g.getBoundingClientRect()), labels: [] }));
    for (const el of svg.querySelectorAll('g.edgeLabel')) {
      if (!el.textContent.trim()) continue;
      const l = toBox(el.getBoundingClientRect());
      if (!l.w || !l.h) continue;
      const cx = l.x + l.w / 2;
      const cy = l.y + l.h / 2;
      // Den minsta grupp som etikettens mitt ligger i.
      const own = clusters
        .filter(c => cx > c.box.x && cx < c.box.x + c.box.w && cy > c.box.y && cy < c.box.y + c.box.h)
        .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0];
      if (own) own.labels.push(l);
    }
    let grown = 0;
    for (const { g, box, labels } of clusters) {
      const d = Labels.growth(box, labels, margin * scale);
      if (Math.max(d.left, d.right, d.top, d.bottom) < 0.5) continue;
      // Rutor som ligger mot gruppens kant följer med åt det hållet (ram, rubrikfält, innehåll).
      for (const rect of g.querySelectorAll('rect')) {
        const r = rect.getBoundingClientRect();
        const k = (rect.getScreenCTM() || { a: 1 }).a;
        const at = (a, b) => Math.abs(a - b) < 1;
        const left = at(r.left, box.x) ? d.left : 0;
        const right = at(r.right, box.x + box.w) ? d.right : 0;
        const top = at(r.top, box.y) ? d.top : 0;
        const bottom = at(r.bottom, box.y + box.h) ? d.bottom : 0;
        if (!left && !right && !top && !bottom) continue;
        rect.setAttribute('x', rect.x.baseVal.value - left / k);
        rect.setAttribute('width', rect.width.baseVal.value + (left + right) / k);
        rect.setAttribute('y', rect.y.baseVal.value - top / k);
        rect.setAttribute('height', rect.height.baseVal.value + (top + bottom) / k);
      }
      // Rubriken hålls mitt på gruppen och överst.
      const title = g.querySelector(':scope > g.cluster-label');
      if (title) {
        const k = (title.parentNode.getScreenCTM() || { a: 1 }).a;
        const m = title.transform.baseVal.consolidate()?.matrix;
        const dx = (d.right - d.left) / 2 / k;
        const dy = -d.top / k;
        title.setAttribute('transform', m
          ? `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e + dx} ${m.f + dy})`
          : `translate(${dx} ${dy})`);
      }
      grown++;
    }
    return grown;
  };

  if (typeof module === 'object' && module.exports) module.exports = Labels;
  else root.Labels = Labels;
})(typeof self !== 'undefined' ? self : this);
