// Inlärningstester: hur Mermaids parser rapporterar syntaxfel när den körs i Node,
// som i tillägget. Slår de fel efter en uppgradering måste radöversättningen ses över.
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkSyntax } = require('../out/mermaidCheck');

test('inlärning parse: giltigt diagram ger inget fel', async () => {
  assert.equal(await checkSyntax('flowchart LR\n  A --> B'), null);
  assert.equal(await checkSyntax('stateDiagram-v2\n  [*] --> A'), null);
});

test('inlärning parse: radnumret räknas från diagramrubriken, efter front matter, init och kommentarsrader', async () => {
  const bad = '  B --> C %% x';
  for (const text of [
    `flowchart LR\n  A --> B\n${bad}`,
    `flowchart LR\n  %% c1\n  %% c2\n  A --> B\n${bad}`,
    `\n\nflowchart LR\n  A --> B\n${bad}`,
    `---\ntitle: T\n---\nflowchart LR\n  A --> B\n${bad}`,
    `%%{init: {"theme":"dark"}}%%\nflowchart LR\n  A --> B\n${bad}`,
  ]) {
    const e = await checkSyntax(text);
    assert.equal(e.kind, 'parse', text);
    assert.equal(e.firstLine, 3, text);
    assert.equal(e.text, '%%', text);
  }
});

test('inlärning parse: tomma rader mitt i diagrammet räknas', async () => {
  const e = await checkSyntax('flowchart LR\n  A --> B\n\n\n  B --> C %% x');
  assert.equal(e.firstLine, 5);
});

test('inlärning parse: indragna kommentarsrader mitt i diagrammet räknas inte', async () => {
  const e = await checkSyntax('flowchart LR\n  A --> B\n    %% indragen\n  B --> C %% x');
  assert.equal(e.firstLine, 3);
});

test('inlärning parse: ostängd sträng ger ett fel som börjar på strängens rad', async () => {
  const e = await checkSyntax('flowchart LR\n  A["text --> B\n  B --> C');
  assert.equal(e.kind, 'parse');
  assert.equal(e.firstLine, 2);
  assert.ok(e.lastLine > e.firstLine);
});

test('inlärning parse: state diagram använder samma radräkning', async () => {
  const e = await checkSyntax('---\ntitle: T\n---\nstateDiagram-v2\n  %% c\n  A --> B\n  A -> -> C');
  assert.equal(e.firstLine, 3);
});

test('inlärning parse: okänd diagramtyp ger fel utan radnummer', async () => {
  const e = await checkSyntax('flowchrt LR\n  A --> B');
  assert.equal(e.kind, 'unknownDiagram');
  assert.equal(e.firstLine, undefined);
});

// ---------------------------------------------------------------- kontrakt: Mermaid ⇄ syntax.ts
const { syntaxDiagnostic } = require('../out/syntax');

test('kontrakt parse: felet markeras på den rad i filen där det står', async () => {
  // [text, 0-baserad rad i filen där felet står]
  const cases = [
    ['---\ntitle: T\nconfig:\n  layout: elk\n---\n%%{init: {}}%%\n\nflowchart LR\n  %% c\n  A --> B\n\n  B --> C %% x', 11],
    ['flowchart LR\n  subgraph s\n    %% indragen\n    A["ostängd --> B\n  end', 3],
    ['stateDiagram-v2\n  %% c\n  [*] --> A\n\n  A -> -> C', 4],
    ['flowchrt LR\n  A --> B', 0],
    ['%% bara kommentar\nstateDiagramm\n  A --> B', 1],
  ];
  for (const [text, line] of cases) {
    const err = await checkSyntax(text);
    assert.ok(err, text);
    assert.equal(syntaxDiagnostic(err, text).line, line, text);
  }
});

test('inlärning parse: markdown-strängar kraschar i Node utan att vara syntaxfel, och ignoreras', async () => {
  assert.equal(await checkSyntax('flowchart LR\n  A["`**fet**`"] --> B'), null);
});
