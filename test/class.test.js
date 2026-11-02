const test = require('node:test');
const assert = require('node:assert/strict');
const { parseClass, filterClass } = require('../out/classParser');
const { nodeKey, edgeKey, subgraphKey, collapseKey } = require('../out/parser');

const demo = `classDiagram
  direction LR
  class Animal {
    +String name
    +eat() void
  }
  <<abstract>> Animal
  class Duck["Anka"]
  Animal <|-- Duck : ärver
  Animal "1" *-- "4" Leg
  Duck : +swim()
  namespace Zoo {
    class Keeper
    namespace Inner {
      class Cage~T~
    }
  }
  Keeper --> Cage : sköter
  Keeper --> Duck
  Keeper ..> Animal
  note for Duck "kan simma"
  style Duck fill:#ff0`;

// ---------------------------------------------------------------- parser

test('class: känner igen classDiagram men inte andra typer', () => {
  assert.equal(parseClass(demo).supported, true);
  assert.equal(parseClass(demo).diagramType, 'classDiagram');
  assert.equal(parseClass('classDiagram-v2\n  class A').supported, true);
  assert.equal(parseClass('flowchart LR\n  A --> B').supported, false);
});

test('class: klasser blir noder med etikett, rad och namespace, utan generics i id:t', () => {
  const m = parseClass(demo);
  assert.deepEqual([...m.nodes.values()].map(n => [n.id, n.label, n.line, n.subgraph]), [
    ['Animal', 'Animal', 2, undefined],
    ['Duck', 'Anka', 7, undefined],
    ['Leg', 'Leg', 9, undefined],
    ['Keeper', 'Keeper', 12, 'Zoo'],
    ['Cage', 'Cage<T>', 14, 'Zoo.Inner'],
  ]);
});

test('class: namespaces blir nästlade grupper med hela sökvägen som id', () => {
  assert.deepEqual([...parseClass(demo).subgraphs.values()], [
    { id: 'Zoo', title: 'Zoo', line: 11, endLine: 16, parent: undefined },
    { id: 'Zoo.Inner', title: 'Inner', line: 13, endLine: 15, parent: 'Zoo' },
  ]);
  const dotted = parseClass('classDiagram\n  namespace A.B {\n    class X\n  }');
  assert.deepEqual([...dotted.subgraphs.values()].map(s => [s.id, s.title, s.parent]), [['A', 'A', undefined], ['A.B', 'B', 'A']]);
  assert.equal(dotted.nodes.get('X').subgraph, 'A.B');
});

test('class: relationer blir kanter med etikett och rad', () => {
  assert.deepEqual(parseClass(demo).edges.map(e => [e.key, e.label, e.line]), [
    ['Animal->Duck#0', 'ärver', 8], ['Animal->Leg#0', '', 9], ['Keeper->Cage#0', 'sköter', 17],
    ['Keeper->Duck#0', '', 18], ['Keeper->Animal#0', '', 19],
  ]);
});

test('class: alla relationstyper, utan mellanslag och med lollipop', () => {
  const m = parseClass('classDiagram\n  A<|--B\n  A *-- B\n  A o-- B\n  A --> B\n  A -- B\n  A ..> B\n  A ..|> B\n  A .. B\n  A <|--|> B\n  C ()-- D\n  E --() F');
  assert.equal(m.edges.length, 11);
  assert.ok(m.edges.slice(0, 9).every(e => e.from === 'A' && e.to === 'B'));
  // Lollipop-sidan är ett gränssnitt, ingen klass.
  assert.deepEqual([...m.nodes.keys()], ['A', 'B', 'D', 'E']);
});

// ---------------------------------------------------------------- filter

test('class: utan något dolt blir texten identisk', () => {
  assert.equal(filterClass(parseClass(demo), new Set()), demo);
});

test('class: dold klass tar bort deklaration, medlemmar, annotation, anteckning och relationer, men style får vara kvar', () => {
  const out = filterClass(parseClass(demo), new Set([nodeKey('Duck')]));
  assert.doesNotMatch(out, /Anka|ärver|swim|Keeper --> Duck|note for/);
  assert.match(out, /\n  style Duck fill:#ff0$/);
  const animal = filterClass(parseClass(demo), new Set([nodeKey('Animal')]));
  assert.doesNotMatch(animal, /Animal \{|String name|abstract|Animal <\||\*--|\.\.>/);
});

test('class: synlig klass som bara fanns i en dold relation behåller sin ruta', () => {
  const out = filterClass(parseClass(demo), new Set([edgeKey('Animal->Leg#0')]));
  assert.match(out, /\n  Animal <\|-- Duck : ärver\n  class Leg\n  Duck : \+swim\(\)/);
});

test('class: namespace utan synliga klasser tas bort, eftersom en tom namespace ger syntaxfel', () => {
  const cage = filterClass(parseClass(demo), new Set([nodeKey('Cage')]));
  assert.match(cage, /\n  namespace Zoo \{\n    class Keeper\n  \}\n/);
  const both = filterClass(parseClass(demo), new Set([nodeKey('Cage'), nodeKey('Keeper')]));
  assert.doesNotMatch(both, /namespace/);
});

test('class: dold namespace döljer sina klasser och deras relationer', () => {
  const out = filterClass(parseClass(demo), new Set([subgraphKey('Zoo')]));
  assert.doesNotMatch(out, /namespace|Keeper|Cage/);
});

test('class: hopfälld namespace blir en klass, relationer dras om och interna försvinner', () => {
  const out = filterClass(parseClass(demo), new Set([collapseKey('Zoo')]));
  assert.equal(out, `classDiagram
  direction LR
  class Animal {
    +String name
    +eat() void
  }
  <<abstract>> Animal
  class Duck["Anka"]
  Animal <|-- Duck : ärver
  Animal "1" *-- "4" Leg
  Duck : +swim()
  class Zoo["Zoo (+2)"]
  Zoo --> Duck
  Zoo ..> Animal
  note for Duck "kan simma"
  style Duck fill:#ff0`);
});

test('class: hopfälld inre namespace hamnar i den yttre, och det yttersta hopfällda vinner', () => {
  const inner = filterClass(parseClass(demo), new Set([collapseKey('Zoo.Inner')]));
  assert.match(inner, /\n  namespace Zoo \{\n    class Keeper\n    class Zoo\.Inner\["Inner \(\+1\)"\]\n  \}\n  Keeper --> Zoo\.Inner : sköter\n/);
  assert.equal(filterClass(parseClass(demo), new Set([collapseKey('Zoo'), collapseKey('Zoo.Inner')])),
    filterClass(parseClass(demo), new Set([collapseKey('Zoo')])));
});

test('class: medlemsrad utanför namespace för en hopfälld klass tas bort så att klassen inte skapas igen', () => {
  const m = parseClass('classDiagram\n  namespace N {\n    class A\n  }\n  A : +x\n  <<interface>> A\n  A --> B');
  assert.equal(filterClass(m, new Set([collapseKey('N')])), 'classDiagram\n  class N["N (+1)"]\n  N --> B');
});
