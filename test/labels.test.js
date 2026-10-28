const test = require('node:test');
const assert = require('node:assert/strict');
const Labels = require('../media/labels');

// Rutor: {x, y, w, h} i diagramkoordinater. separate() ger en förskjutning {dx, dy} per ruta.

const moved = (boxes, offsets) => boxes.map((b, i) => ({ ...b, x: b.x + offsets[i].dx, y: b.y + offsets[i].dy }));
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const anyOverlap = boxes => boxes.some((a, i) => boxes.some((b, j) => j > i && overlaps(a, b)));

test('separate: rutor som inte överlappar flyttas inte', () => {
  const boxes = [{ x: 0, y: 0, w: 50, h: 20 }, { x: 60, y: 0, w: 50, h: 20 }];
  assert.deepEqual(Labels.separate(boxes), [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
});

test('separate: två rutor på samma plats staplas lodrätt runt sin gemensamma mitt', () => {
  const boxes = [{ x: 0, y: 0, w: 50, h: 20 }, { x: 0, y: 0, w: 50, h: 20 }];
  assert.deepEqual(Labels.separate(boxes, { gap: 4 }), [{ dx: 0, dy: -12 }, { dx: 0, dy: 12 }]);
});

test('separate: ordningen längs axeln behålls', () => {
  const boxes = [{ x: 0, y: 10, w: 50, h: 20 }, { x: 0, y: 0, w: 50, h: 20 }];
  const after = moved(boxes, Labels.separate(boxes, { gap: 4 }));
  assert.ok(after[1].y < after[0].y);
  assert.equal(after[0].y - after[1].y, 24);
});

test('separate: axis x staplar vågrätt och lämnar y orört', () => {
  const boxes = [{ x: 0, y: 0, w: 40, h: 20 }, { x: 10, y: 5, w: 40, h: 20 }];
  const offsets = Labels.separate(boxes, { axis: 'x', gap: 4 });
  assert.deepEqual(offsets.map(o => o.dy), [0, 0]);
  const after = moved(boxes, offsets);
  assert.equal(after[1].x - after[0].x, 44);
});

test('separate: en stapel som hamnar på en tredje ruta slås ihop med den', () => {
  const boxes = [{ x: 0, y: 0, w: 50, h: 20 }, { x: 0, y: 0, w: 50, h: 20 }, { x: 0, y: 22, w: 50, h: 20 }];
  assert.equal(anyOverlap(moved(boxes, Labels.separate(boxes))), false);
});

test('separate: slumpade rutor överlappar aldrig efteråt', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let round = 0; round < 200; round++) {
    const boxes = Array.from({ length: 2 + Math.floor(rnd() * 8) }, () => ({
      x: Math.round(rnd() * 100), y: Math.round(rnd() * 60), w: 20 + Math.round(rnd() * 40), h: 10 + Math.round(rnd() * 10),
    }));
    for (const axis of ['x', 'y']) {
      assert.equal(anyOverlap(moved(boxes, Labels.separate(boxes, { axis }))), false, JSON.stringify({ round, axis, boxes }));
    }
  }
});

test('axisFor: lodrät stapling för LR/RL, vågrät för TB/TD/BT', () => {
  assert.equal(Labels.axisFor('flowchart LR\n  A --> B'), 'y');
  assert.equal(Labels.axisFor('%% kommentar\ngraph RL\n  A --> B'), 'y');
  assert.equal(Labels.axisFor('flowchart TB\n  A --> B'), 'x');
  assert.equal(Labels.axisFor('flowchart TD'), 'x');
  assert.equal(Labels.axisFor('graph BT'), 'x');
  assert.equal(Labels.axisFor('flowchart\n  A --> B'), 'x');
});
