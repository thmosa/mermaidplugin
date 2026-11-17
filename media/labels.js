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
   * Mermaid gör inte heller en yttre grupp större när en inre grupp blivit bred av sin titel, så
   * grupperna tas från den minsta till den största och var och en rymmer de inre grupperna som de
   * blev. `titleRoom` (skärm-px) hålls fritt på båda sidor om titeln, för knappen i hörnet.
   * Ger antalet grupper som växte. Kräver DOM (webviewen).
   */
  Labels.fitClusters = (svg, margin = 4, titleRoom = 0) => {
    const scale = (svg.getScreenCTM() || { a: 1 }).a;
    const toBox = r => ({ x: r.left, y: r.top, w: r.width, h: r.height });
    // Gruppens ruta: ramarnas yttre kant (titeln räknas som innehåll nedan).
    const frame = g => {
      const rs = [...g.querySelectorAll('rect')].map(r => r.getBoundingClientRect()).filter(r => r.width || r.height);
      if (!rs.length) return toBox(g.getBoundingClientRect());
      const x = Math.min(...rs.map(r => r.left)), y = Math.min(...rs.map(r => r.top));
      return { x, y, w: Math.max(...rs.map(r => r.right)) - x, h: Math.max(...rs.map(r => r.bottom)) - y };
    };
    const clusters = [...svg.querySelectorAll('g.cluster, g.statediagram-cluster')]
      .map(g => ({ g, box: frame(g), labels: [] }));
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
    // En inre grupp ligger alltid inom den yttre på höjden (det är bara bredden Mermaid missar),
    // så grupperna tas från den lägsta till den högsta, och "ligger i" avgörs av höjden och mitten.
    const inside = (inner, outer) => {
      const cx = inner.x + inner.w / 2;
      return inner.h < outer.h && cx > outer.x && cx < outer.x + outer.w
        && inner.y >= outer.y - 1 && inner.y + inner.h <= outer.y + outer.h + 1;
    };
    clusters.sort((a, b) => a.box.h - b.box.h);
    // Noderna (states, noder), som innehåll i sin grupp och som grannar till andra grupper.
    const nodes = [...svg.querySelectorAll('g.node')].map(n => toBox(n.getBoundingClientRect())).filter(b => b.w && b.h);
    clusters.forEach((c, i) => {
      const { g, labels } = c;
      const box = frame(g);
      const content = [...labels];
      // Mindre grupper i den här, som de blev när de själva växte.
      for (const smaller of clusters.slice(0, i)) {
        const b = frame(smaller.g);
        if (inside(b, box)) content.push(b);
      }
      const d = Labels.growth(box, content, margin * scale);
      // Mermaid gör en grupp bred nog för hela titeln men lägger grannarna som om den vore smal, så
      // den kan gå in i dem. Krymp den då till platsen som finns, men aldrig in i innehållet; titeln
      // kortas sedan med … (fitTitle).
      const centre = box.x + box.w / 2;
      const own = [...content, ...nodes.filter(n => n.x + n.w / 2 > box.x && n.x + n.w / 2 < box.x + box.w
        && n.y + n.h / 2 > box.y && n.y + n.h / 2 < box.y + box.h)];
      const pad = 2 * margin * scale;
      const others = [
        ...clusters.filter(o => o !== c).map(o => frame(o.g)).filter(o => !inside(o, box) && !inside(box, o)),
        ...nodes.filter(n => !own.includes(n)),
      ].filter(o => o.y < box.y + box.h && box.y < o.y + o.h);
      if (own.length) {
        const leftWall = Math.max(-Infinity, ...others.filter(o => o.x + o.w / 2 < centre).map(o => o.x + o.w + margin * scale));
        const rightWall = Math.min(Infinity, ...others.filter(o => o.x + o.w / 2 >= centre).map(o => o.x - margin * scale));
        const shrinkLeft = Math.min(leftWall - box.x, Math.min(...own.map(o => o.x)) - pad - box.x);
        const shrinkRight = Math.min(box.x + box.w - rightWall, box.x + box.w - pad - Math.max(...own.map(o => o.x + o.w)));
        if (d.left <= 0 && shrinkLeft > 0.5) d.left = -shrinkLeft;
        if (d.right <= 0 && shrinkRight > 0.5) d.right = -shrinkRight;
      }
      const title = g.querySelector(':scope > g.cluster-label');
      if (Math.max(Math.abs(d.left), Math.abs(d.right), d.top, d.bottom) < 0.5) {
        if (title) fitTitle(title, frame(g), titleRoom);
        return;
      }
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
      if (title) {
        const k = (title.parentNode.getScreenCTM() || { a: 1 }).a;
        const m = title.transform.baseVal.consolidate()?.matrix;
        const dx = (d.right - d.left) / 2 / k;
        const dy = -d.top / k;
        title.setAttribute('transform', m
          ? `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e + dx} ${m.f + dy})`
          : `translate(${dx} ${dy})`);
        fitTitle(title, frame(g), titleRoom);
      }
      grown++;
    });
    return grown;
  };

  /**
   * Gruppens titel ryms i gruppen med `room` (skärm-px) fritt på båda sidor, för knappen i hörnet.
   * Är den för bred kortas den med … och hela titeln visas när musen hålls över den. Gruppen görs
   * inte bredare för titeln: Mermaid lägger grannarna tätt intill, så den skulle växa in i dem.
   */
  const fitTitle = (title, box, room) => {
    // Texten som syns: HTML-etikett (foreignObject) eller SVG-text.
    const shown = title.querySelector('p, span.nodeLabel, div') || title.querySelector('text');
    if (!shown) return;
    const width = () => (shown.localName === 'div' || shown.closest('foreignObject')
      ? (() => { const r = document.createRange(); r.selectNodeContents(shown); return r.getBoundingClientRect().width; })()
      : shown.getBoundingClientRect().width);
    const max = Math.max(box.w - 2 * room, 0);
    const texts = [];
    const walk = n => { if (n.nodeType === 3) { if (n.data.trim()) texts.push(n); } else n.childNodes.forEach(walk); };
    walk(shown);
    if (texts.length && width() > max + 0.5) {
      const full = texts.map(t => t.data).join(' ').replace(/\s+/g, ' ').trim();
      texts.slice(1).forEach(t => { t.data = ''; });
      // Längsta början av titeln som ryms tillsammans med …
      let lo = 0, hi = full.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        texts[0].data = full.slice(0, mid).trimEnd() + '…';
        if (width() <= max) lo = mid; else hi = mid - 1;
      }
      texts[0].data = full.slice(0, lo).trimEnd() + '…';
      const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      tip.textContent = full;
      title.insertBefore(tip, title.firstChild);
      shown.closest('div')?.setAttribute('title', full);
    }
    // Ny bredd: håll titeln mitt på gruppen och ramen kring HTML-texten lika bred som texten.
    const fo = title.querySelector('foreignObject');
    if (fo) fo.setAttribute('width', width() / (fo.getScreenCTM() || { a: 1 }).a + 2);
    const r = (fo || shown).getBoundingClientRect();
    const dx = (box.x + box.w / 2 - (r.left + r.width / 2)) / (title.parentNode.getScreenCTM() || { a: 1 }).a;
    if (Math.abs(dx) < 0.25) return;
    const m = title.transform.baseVal.consolidate()?.matrix;
    title.setAttribute('transform', m
      ? `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e + dx} ${m.f})`
      : `translate(${dx} 0)`);
  };

  /** Texten som den syns: radbrytningar (br, tspan-rader) blir mellanslag. */
  const visibleText = el => {
    let s = '';
    const walk = n => {
      if (n.nodeType === 3) { s += n.data; return; }
      if (n.nodeType !== 1) return;
      if (/^(br|tspan)$/i.test(n.localName)) s += ' ';
      n.childNodes.forEach(walk);
    };
    walk(el);
    return s.replace(/\s+/g, ' ').trim();
  };

  const EDGE_TEXT_SEL = 'g.edgeLabel, text.messageText';

  /**
   * Piltexterna i SVG:ns ordning: kantetiketter (flowchart, state, class) och meddelandetexter
   * (sequence, en per rad). Tomma etiketter räknas inte. Ger [{el, text}]. Kräver DOM.
   */
  Labels.edgeTexts = svg => [...svg.querySelectorAll(EDGE_TEXT_SEL)]
    .map(el => ({ el, text: visibleText(el) }))
    .filter(t => t.text);

  /** Platsen i Labels.edgeTexts för texten som `el` ligger i, eller -1. */
  Labels.edgeTextIndex = (svg, el) => {
    const own = el.closest(EDGE_TEXT_SEL);
    return own ? Labels.edgeTexts(svg).findIndex(t => t.el === own) : -1;
  };

  if (typeof module === 'object' && module.exports) module.exports = Labels;
  else root.Labels = Labels;
})(typeof self !== 'undefined' ? self : this);
