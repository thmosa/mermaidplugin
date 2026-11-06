// Tecken som ser likadana ut: kyrilliska och grekiska bokstäver som ser ut som latinska, och
// breda tecken (Ｏ). Mermaid ser dem som andra tecken, så "Оrder" med kyrilliskt О blir en
// annan nod än "Order" fast det inte syns i koden.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lookalikeIssues, latinLookalike } = require('../out/lookalike');
const { parseDiagram } = require('../out/diagram');

const find = text => lookalikeIssues(text, parseDiagram(text));
const CYR_O = 'О';   // kyrilliskt О
const CYR_a = 'а';   // kyrilliskt а
const GR_O = 'Ο';    // grekiskt Ο
const WIDE_O = 'Ｏ';  // brett Ｏ
/** Texten på varje markerat ställe, som rad:text. */
const marked = (text, issue) => issue.ranges.map(r => `${r.line}:${text.split('\n')[r.line].slice(r.start, r.end)}`);

test('liknande tecken: översätts till de latinska bokstäver de ser ut som', () => {
  assert.equal(latinLookalike(`${CYR_O}rder`), 'Order');
  assert.equal(latinLookalike(`K${CYR_a}ss${CYR_a}`), 'Kassa');
  assert.equal(latinLookalike(`${GR_O}K`), 'OK');
  assert.equal(latinLookalike(`${WIDE_O}rder１`), 'Order1');
  // Svenska bokstäver är latinska och lämnas som de är.
  assert.equal(latinLookalike('Användare'), 'Användare');
});

test('liknande tecken: latinska och kyrilliska bokstäver blandade i ett namn varnas, med förslag', () => {
  const text = `flowchart LR\n  ${CYR_O}rder --> Kund\n  Kund --> ${CYR_O}rder`;
  const [issue, ...rest] = find(text);
  assert.equal(rest.length, 0);
  assert.equal(issue.id, `${CYR_O}rder`);
  assert.equal(issue.suggestion, 'Order');
  assert.equal(issue.merges, undefined);
  assert.deepEqual(marked(text, issue), [`1:${CYR_O}rder`, `2:${CYR_O}rder`]);
  assert.match(issue.message, new RegExp(`Cyrillic "${CYR_O}" .*Latin "O"`));
});

test('liknande tecken: ett namn som ser ut som ett annat varnas och slås ihop med det', () => {
  const text = `flowchart LR\n  Order --> Kund\n  Kund --> ${CYR_O}rder`;
  const issues = find(text);
  assert.deepEqual(issues.map(i => i.id), [`${CYR_O}rder`], 'det latinska Order är rätt och varnas inte');
  assert.equal(issues[0].merges, 'Order');
  assert.match(issues[0].message, /looks the same as "Order".*different/);
  // Även helt kyrilliska namn som ser exakt ut som ett latinskt.
  const abc = `flowchart LR\n  ABC --> АВС`;
  assert.deepEqual(find(abc).map(i => [i.id, i.merges]), [['АВС', 'ABC']]);
});

test('liknande tecken: kyrilliska, grekiska och svenska namn i sig är inget problem', () => {
  assert.deepEqual(find('flowchart LR\n  Заказ --> Клиент\n  Αλφα --> Användare\n  Öppna --> Ärende'), []);
  // Helt kyrilliskt och utan latinsk tvilling: kan vara ett riktigt ryskt ord (СССР).
  assert.deepEqual(find('flowchart LR\n  СССР --> Kund'), []);
});

test('liknande tecken: breda tecken varnas alltid', () => {
  const text = `flowchart LR\n  ${WIDE_O}rder --> Kund`;
  assert.deepEqual(find(text).map(i => [i.id, i.suggestion]), [[`${WIDE_O}rder`, 'Order']]);
  assert.ok(find(text)[0].message.includes(`full-width "${WIDE_O}"`));
});

test('liknande tecken: text i etiketter, meddelanden och anteckningar räknas inte', () => {
  assert.deepEqual(find(`flowchart LR\n  A[${CYR_O}rder] -->|${CYR_O}k| B`), []);
  assert.deepEqual(find(`sequenceDiagram\n  Kund->>Kassa: ${CYR_O}rder\n  Note over Kund: ${CYR_O}k`), []);
  assert.deepEqual(find(`stateDiagram-v2\n  A --> B : ${CYR_O}k`), []);
});

test('liknande tecken: deltagare, tillstånd och klasser', () => {
  const seq = `sequenceDiagram\n  participant Kund\n  K${CYR_a}ssa->>Kund: betala`;
  assert.deepEqual(find(seq).map(i => i.suggestion), ['Kassa']);
  const state = `stateDiagram-v2\n  [*] --> Idle\n  Idle --> Wait\n  W${CYR_a}it --> [*]`;
  assert.deepEqual(find(state).map(i => [i.suggestion, i.merges]), [['Wait', 'Wait']]);
  const cls = `classDiagram\n  class ${CYR_O}rder\n  ${CYR_O}rder --> Item`;
  assert.deepEqual(find(cls).map(i => i.suggestion), ['Order']);
});

test('liknande tecken: rättningen byter varje användning och slår ihop med tvillingen', () => {
  const text = `flowchart LR\n  Order --> Kund\n  Kund --> ${CYR_O}rder\n  ${CYR_O}rder --> Lager`;
  const [issue] = find(text);
  const lines = text.split('\n');
  for (const r of [...issue.ranges].reverse()) lines[r.line] = lines[r.line].slice(0, r.start) + issue.suggestion + lines[r.line].slice(r.end);
  const fixed = lines.join('\n');
  assert.deepEqual([...parseDiagram(fixed).nodes.keys()].sort(), ['Kund', 'Lager', 'Order']);
  assert.deepEqual(find(fixed), []);
});

test('liknande tecken: inga varningar i exempelfilerna', () => {
  for (const file of fs.readdirSync(path.join(__dirname, '..', 'samples')).filter(f => f.endsWith('.mmd'))) {
    assert.deepEqual(find(fs.readFileSync(path.join(__dirname, '..', 'samples', file), 'utf8')), [], file);
  }
});
