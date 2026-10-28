// Språkkonfigurationen styr VS Codes automatiska indrag, klamrar och kommentarer.
// Mönstren är reguljära uttryck i JSON; här kontrolleras att de träffar rätt rader.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'language-configuration.json'), 'utf8'));
const re = rule => new RegExp(typeof rule === 'string' ? rule : rule.pattern, 'u');
const increase = re(config.indentationRules.increaseIndentPattern);
const decrease = re(config.indentationRules.decreaseIndentPattern);

test('språk: %% är radkommentar', () => {
  assert.equal(config.comments.lineComment, '%%');
});

test('språk: [ ( { och " stängs automatiskt', () => {
  const pairs = config.autoClosingPairs.map(p => (Array.isArray(p) ? p : [p.open, p.close]).join(''));
  for (const p of ['[]', '()', '{}', '""']) assert.ok(pairs.includes(p), p);
});

test('språk: indrag ökar efter rader som öppnar ett block', () => {
  for (const line of [
    'flowchart LR', 'graph TD', 'stateDiagram-v2', 'stateDiagram', 'sequenceDiagram',
    '  subgraph backend [Backend]', '  subgraph Frontend app',
    '  state Crash {', '  state "Stor grupp" as G {',
    '  note left of Fel', '  note right of A',
    '  loop Varje minut', '  alt lyckas', '  else misslyckas', '  opt valfritt', '  par parallellt', '  rect rgb(0,0,0)',
  ]) assert.match(line, increase, line);
});

test('språk: indrag ökar inte efter vanliga rader', () => {
  for (const line of [
    '  A --> B', '  state Crash', '  note right of A : kort text', '  classDef hot fill:#f00',
    '  %% subgraph i en kommentar', '  end', '  }', '  web>Webbapp]', '  user((Användare))',
  ]) assert.doesNotMatch(line, increase, line);
});

test('språk: indrag minskar på rader som stänger ett block', () => {
  for (const line of ['  end', 'end', '  }', '  end note', '  else misslyckas']) assert.match(line, decrease, line);
});

test('språk: indrag minskar inte på vanliga rader', () => {
  for (const line of ['  endpoint --> B', '  A --> end_state', '  Ender', '  {', '  else_state --> A']) {
    assert.doesNotMatch(line, decrease, line);
  }
});

test('meny: högerklick i en Mermaid-fil ger "Preview Diagram" och "View Tree"', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const title = id => pkg.contributes.commands.find(c => c.command === id)?.title;
  const menu = pkg.contributes.menus['editor/context'] ?? [];
  for (const [command, expected] of [['mermaidTree.openPreview', 'Preview Diagram'], ['mermaidTree.showTree', 'View Tree']]) {
    assert.equal(title(command), expected);
    const entry = menu.find(m => m.command === command);
    assert.ok(entry, `${command} saknas i editor/context`);
    assert.equal(entry.when, 'resourceLangId == mermaid');
  }
});

test('språk: package.json kopplar konfiguration och grammatik till mermaid', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lang = pkg.contributes.languages.find(l => l.id === 'mermaid');
  assert.equal(lang.configuration, './language-configuration.json');
  const grammar = pkg.contributes.grammars.find(g => g.language === 'mermaid');
  assert.ok(fs.existsSync(path.join(root, grammar.path)), grammar.path);
  assert.equal(grammar.scopeName, 'source.mermaid');
});
