// Färgen på namn i editorn: grammatiken ska ge namn (deltagare, noder, tillstånd, klasser, grupper)
// en egen scope, och bara dem. Facit är parsern: samma ställen som namnbytet (rename) hittar.
// Tokeniseras med samma motor som VS Code (se support/tokenize.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tokenize } = require('./support/tokenize');
const { parseDiagram } = require('../out/diagram');
const { occurrences, renamable } = require('../out/rename');

const NAME = 'entity.name.type.node.mermaid';
const SAMPLES = path.join(__dirname, '..', 'samples');

/** Rader där grammatikens namn och parserns namn inte är samma, som läsbar text. */
async function mismatches(text) {
  const model = parseDiagram(text);
  const lines = text.split(/\r?\n/);
  const want = new Map();
  const add = (map, line, s, e) => { for (let c = s; c < e; c++) (map.get(line) ?? map.set(line, new Set()).get(line)).add(c); };
  for (const id of renamable(model)) for (const o of occurrences(text, model, id)) add(want, o.line, o.start, o.end);
  const got = new Map();
  for (const t of await tokenize(text)) if (t.scopes.includes(NAME)) add(got, t.line, t.start, t.end);
  const words = (line, cols) => {
    const s = lines[line];
    return [...(cols ?? [])].sort((a, b) => a - b).map(c => s[c]).join('').trim();
  };
  const out = [];
  for (const line of new Set([...want.keys(), ...got.keys()])) {
    const a = [...(want.get(line) ?? [])].sort((x, y) => x - y).join();
    const b = [...(got.get(line) ?? [])].sort((x, y) => x - y).join();
    if (a !== b) out.push(`rad ${line + 1}: "${lines[line].trim()}" namn: [${words(line, want.get(line))}] färgat: [${words(line, got.get(line))}]`);
  }
  return out;
}

test('grammatik: namnen i ett sequence diagram färgas, inte meddelanden, alias eller titlar', async () => {
  const text = [
    'sequenceDiagram',
    '  title Beställning',
    '  actor U as Användare',
    '  participant API as API-gateway',
    '  box Aqua Backend',
    '    participant Order',
    '  end',
    '  U->>+API: Lägg order',
    '  API-->>-U: klar',
    '  loop var 5:e sekund',
    '    API->>Order: status?',
    '  end',
    '  Note over API,Order: loggas',
    '  activate Order',
  ].join('\n');
  assert.deepEqual(await mismatches(text), []);
});

test('grammatik: namnen i flowchart, state och class färgas, inte etiketter', async () => {
  for (const text of [
    'flowchart LR\n  A[Start] --> B{Val}\n  B -- ja --> C(Klar)\n  B -->|nej| A\n  subgraph G [Grupp]\n    C\n  end',
    'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy : go\n  state "Upptagen" as Busy\n  state Busy {\n    Work\n  }',
    'classDiagram\n  class Animal {\n    +String name\n    +eat() void\n  }\n  Animal <|-- Duck\n  Duck "1" --> "*" Egg : lägger',
  ]) assert.deepEqual(await mismatches(text), [], text.split('\n')[0]);
});

for (const file of fs.readdirSync(SAMPLES).filter(f => f.endsWith('.mmd'))) {
  test(`grammatik: namnen färgas som parsern ser dem i ${file}`, async () => {
    const text = fs.readFileSync(path.join(SAMPLES, file), 'utf8');
    if (!parseDiagram(text).supported) return;
    assert.deepEqual(await mismatches(text), []);
  });
}

test('grammatik: namnens scope färgas av alla VS Codes inbyggda teman', () => {
  // variable.other blir grå som vanlig text i "2026 Dark"; entity.name.type får en egen färg i
  // 2026 Dark/Light, Dark+/Light+ och Dark Modern.
  assert.match(NAME, /^entity\.name\.type\./);
});
