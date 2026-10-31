const test = require('node:test');
const assert = require('node:assert/strict');
const { documentLine, syntaxDiagnostic } = require('../out/syntax');

// Mermaid räknar rader efter att front matter, %%-rader och tomma rader före rubriken tagits bort.

test('syntax: utan förbehandling är Mermaids rad N filens rad N', () => {
  assert.equal(documentLine('flowchart LR\n  A --> B\n  B --> C', 3), 2);
});

test('syntax: front matter, init, kommentarer och tomma rader före rubriken räknas inte', () => {
  const text = '---\ntitle: T\n---\n\n%%{init: {}}%%\n%% c\nflowchart LR\n  %% c2\n  A --> B\n\n  B --> C';
  assert.equal(documentLine(text, 1), 6);
  assert.equal(documentLine(text, 2), 8);
  assert.equal(documentLine(text, 3), 9, 'tom rad efter rubriken räknas');
  assert.equal(documentLine(text, 4), 10);
});

test('syntax: rad bortom slutet blir sista raden med innehåll', () => {
  assert.equal(documentLine('flowchart LR\n  A --> B\n\n', 9), 1);
});

test('syntax: felet markerar texten Mermaid stannade på, annars hela raden utan indrag', () => {
  const text = 'flowchart LR\n  A --> B\n  B --> C %% x';
  const d = syntaxDiagnostic({ kind: 'parse', message: 'Parse error on line 3:\n...', firstLine: 3, lastLine: 3, text: '%%' }, text);
  assert.deepEqual([d.line, d.start, d.end], [2, 10, 12]);
  assert.match(d.message, /^Mermaid syntax error near "%%"/);
  assert.match(d.message, /Parse error on line 3/);

  const whole = syntaxDiagnostic({ kind: 'parse', message: 'Parse error', firstLine: 2, lastLine: 3 }, text);
  assert.deepEqual([whole.line, whole.start, whole.end], [1, 2, 9]);
  assert.match(whole.message, /^Mermaid syntax error/);
});

test('syntax: om texten inte finns på raden markeras hela raden', () => {
  const d = syntaxDiagnostic({ kind: 'parse', message: 'x', firstLine: 2, lastLine: 2, text: 'saknas' }, 'flowchart LR\n  A --> B');
  assert.deepEqual([d.line, d.start, d.end], [1, 2, 9]);
});

test('syntax: okänd diagramtyp markerar rubrikraden', () => {
  const text = '---\ntitle: T\n---\n%% c\nflowchrt LR\n  A --> B';
  const d = syntaxDiagnostic({ kind: 'unknownDiagram', message: 'No diagram type detected' }, text);
  assert.deepEqual([d.line, d.start, d.end], [4, 0, 11]);
  assert.match(d.message, /^Unknown diagram type/);
});

test('syntax: tom fil ger ingen markering', () => {
  assert.equal(syntaxDiagnostic({ kind: 'unknownDiagram', message: 'x' }, '\n\n'), null);
});
