const test = require('node:test');
const assert = require('node:assert/strict');
const { idAt, rename } = require('../out/rename');
const { parseDiagram } = require('../out/diagram');

/** Byter namn och ger den nya texten, eller kastar felet. */
function renamed(text, id, newName) {
  const r = rename(text, parseDiagram(text), id, newName);
  if (r.error) throw new Error(r.error);
  const lines = text.split('\n');
  // Ändringarna ska vara sorterade och inte överlappa; de görs bakifrån så att kolumnerna stämmer.
  for (const e of [...r.edits].reverse()) {
    lines[e.line] = lines[e.line].slice(0, e.start) + newName + lines[e.line].slice(e.end);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- flowchart

const flow = `flowchart LR
  %% Order flödet
  Order[Order skapas] --> Lager{Finns Order?}
  Order -->|Order klar| Kund
  subgraph Sys [Order-system]
    Lager
  end
  class Order hot
  click Order "https://x.se" "Order"
  style Order fill:#f00
  OrderLine --> Order`;

test('byt namn flowchart: id:t byts överallt där det används, men inte i etiketter, kommentarer eller andra id:n', () => {
  assert.equal(renamed(flow, 'Order', 'Best'), `flowchart LR
  %% Order flödet
  Best[Order skapas] --> Lager{Finns Order?}
  Best -->|Order klar| Kund
  subgraph Sys [Order-system]
    Lager
  end
  class Best hot
  click Best "https://x.se" "Order"
  style Best fill:#f00
  OrderLine --> Best`);
});

test('byt namn flowchart: subgraf', () => {
  assert.match(renamed(flow, 'Sys', 'System'), /\n  subgraph System \[Order-system\]\n/);
});

test('byt namn: id vid markören, men inte i etiketter, kommentarer eller nyckelord', () => {
  const m = parseDiagram(flow);
  assert.deepEqual(idAt(flow, m, 2, 30), { id: 'Lager', line: 2, start: 26, end: 31 });
  assert.deepEqual(idAt(flow, m, 2, 2), { id: 'Order', line: 2, start: 2, end: 7 });
  assert.deepEqual(idAt(flow, m, 4, 13), { id: 'Sys', line: 4, start: 11, end: 14 });
  assert.equal(idAt(flow, m, 2, 12), undefined, 'etikett');
  assert.equal(idAt(flow, m, 1, 6), undefined, 'kommentar');
  assert.equal(idAt(flow, m, 6, 3), undefined, 'end');
});

test('byt namn: ogiltiga, upptagna och reserverade namn ger fel', () => {
  const m = parseDiagram(flow);
  assert.match(rename(flow, m, 'Order', 'Lager').error, /already exists/);
  assert.match(rename(flow, m, 'Order', 'lager').error, /letter case/);
  assert.match(rename(flow, m, 'Order', 'end').error, /reserved/);
  assert.match(rename(flow, m, 'Order', 'två ord').error, /letters, digits/);
  assert.match(rename(flow, m, 'Order', '').error, /letters, digits/);
  assert.deepEqual(rename(flow, m, 'Order', 'Order').edits, []);
});

// ---------------------------------------------------------------- state

const state = `stateDiagram-v2
  [*] --> Idle
  Idle --> Busy : Idle till Busy
  state Busy {
    [*] --> Work
  }
  note right of Idle
    Idle väntar
  end note
  note left of Busy : Busy jobbar
  state "Idle läge" as Idle2
  Idle2 --> Idle
  class Idle hot`;

test('byt namn state: tillstånd, men inte övergångstext, anteckningar eller andra id:n', () => {
  assert.equal(renamed(state, 'Idle', 'Vila'), `stateDiagram-v2
  [*] --> Vila
  Vila --> Busy : Idle till Busy
  state Busy {
    [*] --> Work
  }
  note right of Vila
    Idle väntar
  end note
  note left of Busy : Busy jobbar
  state "Idle läge" as Idle2
  Idle2 --> Vila
  class Vila hot`);
});

test('byt namn state: sammansatt tillstånd', () => {
  const out = renamed(state, 'Busy', 'Jobb');
  assert.match(out, /\n  Idle --> Jobb : Idle till Busy\n  state Jobb \{\n/);
  assert.match(out, /\n  note left of Jobb : Busy jobbar\n/);
});

// ---------------------------------------------------------------- sequence

const seq = `sequenceDiagram
  title API översikt
  participant API as Mitt API
  actor U
  box Aqua API zon
    participant DB
  end
  U->>+API: anropa API
  loop API pollar
    API->>DB: läs
  end
  Note over API,DB: API läser
  activate API
  create participant Log
  API->>Log: skriv
  destroy Log
  Log-->>API: klart
  link API: Dashboard @ https://x.se`;

test('byt namn sequence: deltagare, men inte titel, alias, box- och blocktitlar, meddelanden eller anteckningstext', () => {
  assert.equal(renamed(seq, 'API', 'Gw'), `sequenceDiagram
  title API översikt
  participant Gw as Mitt API
  actor U
  box Aqua API zon
    participant DB
  end
  U->>+Gw: anropa API
  loop API pollar
    Gw->>DB: läs
  end
  Note over Gw,DB: API läser
  activate Gw
  create participant Log
  Gw->>Log: skriv
  destroy Log
  Log-->>Gw: klart
  link Gw: Dashboard @ https://x.se`);
});

test('byt namn sequence: box och block har inga namn att byta', () => {
  const m = parseDiagram(seq);
  assert.equal(idAt(seq, m, 4, 12), undefined);
  assert.equal(idAt(seq, m, 8, 9), undefined);
});

// ---------------------------------------------------------------- class

const cls = `classDiagram
  class Order {
    +Order kopia
    +int antal
  }
  class Kund["Order-kund"]
  Kund --> Order : Order läggs
  Order : +starta()
  <<entity>> Order
  note for Order "Order-anteckning"
  namespace Salj {
    class Offert
  }
  style Order fill:#f00
  cssClass "Order,Kund" hot
  Offert ..> Order`;

test('byt namn class: klass, men inte medlemmar, etiketter, relationstext eller anteckningstext', () => {
  assert.equal(renamed(cls, 'Order', 'Best'), `classDiagram
  class Best {
    +Order kopia
    +int antal
  }
  class Kund["Order-kund"]
  Kund --> Best : Order läggs
  Best : +starta()
  <<entity>> Best
  note for Best "Order-anteckning"
  namespace Salj {
    class Offert
  }
  style Best fill:#f00
  cssClass "Best,Kund" hot
  Offert ..> Best`);
});

test('byt namn class: namespace, även nästlad och med punkt i deklarationen', () => {
  assert.match(renamed(cls, 'Salj', 'Forsaljning'), /\n  namespace Forsaljning \{\n/);
  const nested = 'classDiagram\n  namespace A {\n    namespace B {\n      class X\n    }\n  }\n  namespace A.B {\n    class Y\n  }';
  assert.equal(renamed(nested, 'A.B', 'C'), 'classDiagram\n  namespace A {\n    namespace C {\n      class X\n    }\n  }\n  namespace A.C {\n    class Y\n  }');
  assert.deepEqual(idAt(nested, parseDiagram(nested), 6, 14), { id: 'A.B', line: 6, start: 14, end: 15 });
});

// ---------------------------------------------------------------- dolt och hopfällt följer med

const { renameKeys } = require('../out/rename');

test('byt namn: dolda och hopfällda nycklar följer med, även kanter och namespace-sökvägar', () => {
  const hidden = new Set(['n:Order', 'n:OrderLine', 'e:Order->Kund#0', 'e:Kund->Order#1', 'e:A->B#0', 's:Order', 'c:Order']);
  assert.deepEqual([...renameKeys(hidden, 'Order', 'Best')].sort(),
    ['c:Best', 'e:A->B#0', 'e:Best->Kund#0', 'e:Kund->Best#1', 'n:Best', 'n:OrderLine', 's:Best'].sort());
  const ns = new Set(['c:A.B', 's:A.B.C', 'c:A.BC', 'n:X']);
  assert.deepEqual([...renameKeys(ns, 'A.B', 'A.D')].sort(), ['c:A.BC', 'c:A.D', 'n:X', 's:A.D.C'].sort());
});
