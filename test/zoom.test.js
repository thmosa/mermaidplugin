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
