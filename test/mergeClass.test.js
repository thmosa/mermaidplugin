// Flera klassdiagram ritade tillsammans: klasser med samma namn blir en, så att relationerna
// hänger ihop över filerna. Källfilerna ändras aldrig; texten är bara det som ritas.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeClassDiagrams } = require('../out/mergeClass');
const { parseDiagram } = require('../out/diagram');

const file = (name, ...lines) => ({ name, text: ['classDiagram', ...lines].join('\n') });
const merge = (...files) => mergeClassDiagrams(files);
/** Raderna som inte är kommentarer, utan indrag. */
const code = r => r.text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('%%'));
const count = (r, line) => code(r).filter(l => l === line).length;

test('sammanslagning: klasser med samma namn blir en och relationerna hänger ihop', () => {
  const r = merge(
    file('kund.mmd', '  class Kund {', '    +namn', '  }', '  Kund --> Order : gör'),
    file('order.mmd', '  class Order', '  Order --> Rad : har', '  Kund --> Adress : bor'));
  assert.equal(r.error, undefined);
  const m = parseDiagram(r.text);
  assert.equal(m.diagramType, 'classDiagram');
  assert.deepEqual([...m.nodes.keys()].sort(), ['Adress', 'Kund', 'Order', 'Rad']);
  assert.deepEqual(m.edges.map(e => `${e.from}->${e.to}`), ['Kund->Order', 'Order->Rad', 'Kund->Adress']);
  assert.deepEqual(r.conflicts, []);
  assert.equal(count(r, 'classDiagram'), 1);
});

test('sammanslagning: en medlem som finns i flera filer visas en gång, olika medlemmar blir kvar', () => {
  const r = merge(
    file('a.mmd', '  class Kund {', '    +namn', '    +epost', '  }'),
    file('b.mmd', '  class Kund {', '    +namn', '    +telefon', '  }'));
  assert.equal(count(r, '+namn'), 1);
  assert.equal(count(r, '+epost'), 1);
  assert.equal(count(r, '+telefon'), 1);
});

test('sammanslagning: medlem i klassens block och på egen rad räknas som samma', () => {
  const r = merge(
    file('a.mmd', '  class Kund {', '    +namn', '  }'),
    file('b.mmd', '  Kund : +namn', '  Kund : +epost'));
  assert.equal(count(r, 'Kund : +namn'), 0);
  assert.equal(count(r, 'Kund : +epost'), 1);
});

test('sammanslagning: samma annotation och anteckning i flera filer visas en gång', () => {
  const r = merge(
    file('a.mmd', '  class Sparbar {', '    <<interface>>', '  }', '  note for Sparbar "Sparas"'),
    file('b.mmd', '  class Sparbar', '  <<interface>> Sparbar', '  note for Sparbar "Sparas"'));
  assert.equal(count(r, '<<interface>> Sparbar'), 0);
  assert.equal(count(r, 'note for Sparbar "Sparas"'), 1);
});

test('sammanslagning: samma relation i flera filer ritas en gång, oavsett mellanslag', () => {
  const r = merge(
    file('a.mmd', '  Kund "1" --> "*" Order : gör'),
    file('b.mmd', '  Kund  "1"-->"*"  Order :  gör'));
  assert.equal(parseDiagram(r.text).edges.length, 1);
});

test('sammanslagning: relationer med annan text, multiplicitet eller pil är olika', () => {
  const r = merge(
    file('a.mmd', '  Kund --> Order : gör'),
    file('b.mmd', '  Kund --> Order : avbryter', '  Kund "1" --> Order : gör', '  Kund ..> Order : gör'));
  assert.equal(parseDiagram(r.text).edges.length, 4);
});

test('sammanslagning: det som står två gånger i samma fil rörs inte', () => {
  const r = merge(file('a.mmd', '  Kund --> Order', '  Kund --> Order', '  Kund : +namn', '  Kund : +namn'), file('b.mmd', '  class Lager'));
  assert.equal(parseDiagram(r.text).edges.length, 2);
  assert.equal(count(r, 'Kund : +namn'), 2);
});

test('sammanslagning: varje rad vet vilken fil och rad den kommer från', () => {
  const a = file('a.mmd', '  class A', '  A --> B');
  const b = file('b.mmd', '', '  %% kommentar', '  class C');
  const r = merge(a, b);
  const src = [a, b];
  r.text.split('\n').forEach((line, i) => {
    const s = r.sources[i];
    if (line.trim() === 'classDiagram' || line.trim().startsWith('%%')) return assert.equal(s, undefined, line);
    assert.equal(src[s.file].text.split('\n')[s.line], line);
  });
  assert.deepEqual(r.sources[r.text.split('\n').indexOf('  class C')], { file: 1, line: 3 });
  assert.equal(r.sources.length, r.text.split('\n').length);
});

test('sammanslagning: raden före varje fils innehåll visar filens namn', () => {
  const r = merge(file('kund.mmd', '  class A'), file('order.mmd', '  class B'));
  const lines = r.text.split('\n');
  assert.ok(lines.findIndex(l => /%%.*kund\.mmd/.test(l)) < lines.indexOf('  class A'));
  assert.ok(lines.findIndex(l => /%%.*order\.mmd/.test(l)) < lines.indexOf('  class B'));
});

test('sammanslagning: första filens riktning gäller, en annan riktning varnas', () => {
  const same = merge(file('a.mmd', '  direction LR', '  class A'), file('b.mmd', '  direction LR', '  class B'));
  assert.equal(code(same).filter(l => l.startsWith('direction')).length, 1);
  assert.deepEqual(same.conflicts, []);
  const r = merge(file('a.mmd', '  direction LR', '  class A'), file('b.mmd', '  direction TB', '  class B'));
  assert.deepEqual(code(r).filter(l => l.startsWith('direction')), ['direction LR']);
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0].message, /b\.mmd.*TB.*LR/);
  assert.equal(r.text.split('\n')[r.conflicts[0].line].trim(), 'direction LR');
});

test('sammanslagning: inställningar i filhuvudet och %%{init}%% tas bort så att de inte krockar', () => {
  const a = { name: 'a.mmd', text: '---\ntitle: A\n---\nclassDiagram\n  class A' };
  const b = { name: 'b.mmd', text: '%%{init: {"theme": "forest"}}%%\nclassDiagram\n  class B' };
  const r = merge(a, b);
  assert.deepEqual(code(r), ['classDiagram', 'class A', 'class B']);
});

test('sammanslagning: olika etiketter på samma klass varnas, lika eller saknad etikett inte', () => {
  const r = merge(file('a.mmd', '  class K["Kund A"]'), file('b.mmd', '  class K["Kund B"]'));
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0].message, /"K".*Kund A.*a\.mmd.*Kund B.*b\.mmd/);
  assert.equal(r.text.split('\n')[r.conflicts[0].line].trim(), 'class K["Kund B"]');
  assert.deepEqual(merge(file('a.mmd', '  class K["Kund"]'), file('b.mmd', '  class K["Kund"]')).conflicts, []);
  assert.deepEqual(merge(file('a.mmd', '  class K["Kund"]'), file('b.mmd', '  class K')).conflicts, []);
});

test('sammanslagning: samma klass i olika namespaces varnas, samma namespace inte', () => {
  const ns = (name, n) => file(name, `  namespace ${n} {`, '    class Kund', '  }');
  const r = merge(ns('a.mmd', 'Salj'), ns('b.mmd', 'Ekonomi'));
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0].message, /"Kund".*Salj.*a\.mmd.*Ekonomi.*b\.mmd/);
  assert.deepEqual(merge(ns('a.mmd', 'Salj'), ns('b.mmd', 'Salj')).conflicts, []);
  // Utan namespace i ena filen finns ingen konflikt.
  assert.deepEqual(merge(ns('a.mmd', 'Salj'), file('b.mmd', '  class Kund')).conflicts, []);
});

test('sammanslagning: en fil som inte är ett klassdiagram ger fel med filens namn', () => {
  const r = merge(file('a.mmd', '  class A'), { name: 'flode.mmd', text: 'flowchart LR\n  A --> B' });
  assert.match(r.error, /flode\.mmd/);
});
