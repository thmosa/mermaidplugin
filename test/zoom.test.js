const test = require('node:test');
const assert = require('node:assert/strict');
const Zoom = require('../media/zoom');

// Vy: (cx, cy) är mittpunkten i diagramkoordinater, s = skärmpixlar per diagramenhet.
// Skärmkoordinater räknas från scenens övre vänstra hörn.
const size = { w: 800, h: 600 };

const near = (actual, expected, eps = 1e-9) => {
  for (const k of Object.keys(expected)) {
    assert.ok(Math.abs(actual[k] - expected[k]) < eps, `${k}: ${actual[k]} ≠ ${expected[k]}`);
  }
};

test('viewBox: skala 1 visar scenens storlek runt mittpunkten', () => {
  near(Zoom.viewBox({ cx: 100, cy: 50, s: 1 }, size), { x: -300, y: -250, w: 800, h: 600 });
});

test('viewBox: dubbel skala visar halva ytan', () => {
  near(Zoom.viewBox({ cx: 0, cy: 0, s: 2 }, size), { x: -200, y: -150, w: 400, h: 300 });
});

test('toDiagram: scenens mitt motsvarar vyns mittpunkt', () => {
  near(Zoom.toDiagram({ cx: 100, cy: 50, s: 2 }, size, { x: 400, y: 300 }), { x: 100, y: 50 });
});

test('toDiagram: övre vänstra hörnet tar hänsyn till skalan', () => {
  near(Zoom.toDiagram({ cx: 0, cy: 0, s: 2 }, size, { x: 0, y: 0 }), { x: -200, y: -150 });
});

test('toScreen är inversen av toDiagram', () => {
  const view = { cx: 37, cy: -12, s: 0.7 };
  const p = { x: 123, y: 456 };
  near(Zoom.toScreen(view, size, Zoom.toDiagram(view, size, p)), p);
});

test('zoomAt: punkten under pekaren står still', () => {
  const view = { cx: 100, cy: 50, s: 1 };
  const pointer = { x: 650, y: 120 };
  const under = Zoom.toDiagram(view, size, pointer);
  const zoomed = Zoom.zoomAt(view, size, 1.5, pointer);
  near(Zoom.toScreen(zoomed, size, under), pointer);
});

test('zoomAt: skalan multipliceras med faktorn', () => {
  assert.equal(Zoom.zoomAt({ cx: 0, cy: 0, s: 2 }, size, 0.5, { x: 400, y: 300 }).s, 1);
});

test('zoomAt i scenens mitt ändrar inte mittpunkten', () => {
  near(Zoom.zoomAt({ cx: 7, cy: 9, s: 1 }, size, 3, { x: 400, y: 300 }), { cx: 7, cy: 9, s: 3 });
});

test('zoomAt: skalan begränsas till MIN_SCALE och MAX_SCALE', () => {
  const p = { x: 400, y: 300 };
  assert.equal(Zoom.zoomAt({ cx: 0, cy: 0, s: 1 }, size, 1000, p).s, Zoom.MAX_SCALE);
  assert.equal(Zoom.zoomAt({ cx: 0, cy: 0, s: 1 }, size, 0.0001, p).s, Zoom.MIN_SCALE);
});

test('zoomAt: punkten står still även när skalan begränsas', () => {
  const view = { cx: 0, cy: 0, s: 1 };
  const pointer = { x: 100, y: 500 };
  const under = Zoom.toDiagram(view, size, pointer);
  near(Zoom.toScreen(Zoom.zoomAt(view, size, 1000, pointer), size, under), pointer);
});

const base = { x: 10, y: 20, w: 1000, h: 400 };

test('fit "all": hela diagrammet syns och den begränsande sidan fyller ut minus marginal', () => {
  const view = Zoom.fit(base, size, 'all');
  // Bredden begränsar: (800 - 2*PAD) / 1000
  assert.equal(view.s, (size.w - 2 * Zoom.PAD) / base.w);
  near(view, { cx: 510, cy: 220 });
  const left = Zoom.toScreen(view, size, { x: base.x, y: base.y });
  near(left, { x: Zoom.PAD });
});

test('fit "all": ett högt diagram begränsas av höjden', () => {
  const tall = { x: 0, y: 0, w: 100, h: 2000 };
  assert.equal(Zoom.fit(tall, size, 'all').s, (size.h - 2 * Zoom.PAD) / tall.h);
});

test('fit "width": fyller bredden och lägger diagrammets överkant vid marginalen', () => {
  const tall = { x: 0, y: 0, w: 100, h: 2000 };
  const view = Zoom.fit(tall, size, 'width');
  assert.equal(view.s, (size.w - 2 * Zoom.PAD) / tall.w);
  near(Zoom.toScreen(view, size, { x: 0, y: 0 }), { x: Zoom.PAD, y: Zoom.PAD });
});

test('fit "actual": skala 1 och diagrammet centrerat', () => {
  near(Zoom.fit(base, size, 'actual'), { cx: 510, cy: 220, s: 1 });
});

test('fit: ett enormt diagram begränsas till MIN_SCALE', () => {
  assert.equal(Zoom.fit({ x: 0, y: 0, w: 1e7, h: 1e7 }, size, 'all').s, Zoom.MIN_SCALE);
});

test('fit: en scen utan storlek (dold panel) ger null så att anroparen kan vänta', () => {
  assert.equal(Zoom.fit(base, { w: 0, h: 600 }, 'all'), null);
  assert.equal(Zoom.fit(base, { w: 800, h: 0 }, 'width'), null);
});
