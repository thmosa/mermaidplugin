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
    'classDiagram', '  class Animal {', '  namespace Zoo {',
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

test('meny: grupper i trädet kan fällas ihop och ut i diagrammet', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const title = id => pkg.contributes.commands.find(c => c.command === id)?.title;
  assert.equal(title('mermaidTree.collapseGroup'), 'Collapse in Diagram');
  assert.equal(title('mermaidTree.expandGroup'), 'Expand in Diagram');
  const items = pkg.contributes.menus['view/item/context'];
  // Tolkar viewItem == x och viewItem =~ /re/ i when-villkoret.
  const shownFor = (id, viewItem) => items.filter(m => m.command === id).some(m => {
    const eq = /viewItem == (\w+)/.exec(m.when);
    const re = /viewItem =~ \/(.+?)\/(?:\s|$)/.exec(m.when);
    return eq ? eq[1] === viewItem : re ? new RegExp(re[1]).test(viewItem) : false;
  });
  for (const item of ['subgraph', 'section', 'block']) assert.ok(shownFor('mermaidTree.collapseGroup', item), item);
  for (const item of ['subgraphCollapsed', 'sectionCollapsed', 'blockCollapsed']) assert.ok(shownFor('mermaidTree.expandGroup', item), item);
  assert.ok(!shownFor('mermaidTree.collapseGroup', 'subgraphCollapsed'));
  assert.ok(shownFor('mermaidTree.hideItem', 'subgraphCollapsed'), 'hopfälld grupp ska också gå att dölja');
  assert.ok(!shownFor('mermaidTree.hideItem', 'section'), 'en gren går inte att dölja');
  for (const item of ['block', 'blockCollapsed']) assert.ok(shownFor('mermaidTree.hideItem', item), item);
  // Byt namn: noder och grupper med riktiga namn, men inte box, block eller grenar.
  assert.equal(title('mermaidTree.renameItem'), 'Rename…');
  for (const item of ['node', 'subgraph', 'subgraphCollapsed']) assert.ok(shownFor('mermaidTree.renameItem', item), item);
  for (const item of ['box', 'block', 'section', 'edge']) assert.ok(!shownFor('mermaidTree.renameItem', item), item);
});

test('språk: package.json kopplar konfiguration och grammatik till mermaid', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lang = pkg.contributes.languages.find(l => l.id === 'mermaid');
  assert.equal(lang.configuration, './language-configuration.json');
  const grammar = pkg.contributes.grammars.find(g => g.language === 'mermaid');
  assert.ok(fs.existsSync(path.join(root, grammar.path)), grammar.path);
  assert.equal(grammar.scopeName, 'source.mermaid');
});

test('grammatik: nyckelord för class diagram färgas', () => {
  const grammar = JSON.parse(fs.readFileSync(path.join(root, 'syntaxes', 'mermaid.tmLanguage.json'), 'utf8'));
  const keywords = JSON.stringify(grammar).match(/\(subgraph\|[^)]*\)/)[0];
  const re = new RegExp(String.raw`^\s*${keywords}\b`);
  for (const word of ['class', 'namespace', 'cssClass', 'click', 'link', 'callback']) assert.match(`  ${word} X`, re, word);
});

test('grammatik: anteckningar färgas oavsett stor eller liten bokstav, som Mermaid läser dem', () => {
  const grammar = JSON.parse(fs.readFileSync(path.join(root, 'syntaxes', 'mermaid.tmLanguage.json'), 'utf8'));
  const inline = new RegExp(grammar.repository['note-inline'].match);
  for (const line of ['  Note over API,Order: hela flödet', '  note right of U: väntar', '  NOTE Left Of X: a']) {
    const m = inline.exec(line);
    assert.ok(m, line);
    assert.match(m[1], /^note$/i);
  }
  const block = grammar.repository['note-block'];
  assert.match('  Note left of Fel', new RegExp(block.begin));
  assert.match('  End Note', new RegExp(block.end));
  // Indraget ökar också efter "Note left of X".
  assert.match('  Note left of Fel', increase);
});

test('grammatik: create och destroy i sequence diagram färgas', () => {
  const grammar = JSON.parse(fs.readFileSync(path.join(root, 'syntaxes', 'mermaid.tmLanguage.json'), 'utf8'));
  const keywords = JSON.stringify(grammar).match(/\(subgraph\|[^)]*\)/)[0];
  const re = new RegExp(String.raw`^\s*${keywords}\b`);
  for (const word of ['create', 'destroy']) assert.match(`  ${word} participant X`, re, word);
});

test('meny: kugghjulet sist i panelens rubrik öppnar tilläggets inställningar', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const cmd = pkg.contributes.commands.find(c => c.command === 'mermaidTree.openSettings');
  assert.ok(cmd, 'kommandot saknas');
  assert.equal(cmd.title, 'Settings');
  assert.equal(cmd.icon, '$(gear)');
  const menu = pkg.contributes.menus['view/title'].filter(m => /^navigation/.test(m.group));
  const order = g => Number(g.split('@')[1]);
  const gear = menu.find(m => m.command === 'mermaidTree.openSettings');
  assert.match(gear.when, /view == mermaidTree\.structure/);
  assert.ok(menu.every(m => m === gear || order(m.group) < order(gear.group)), 'kugghjulet ska ligga sist');
  // Kommandot öppnar inställningarna filtrerade på tillägget.
  const src = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
  assert.match(src, /registerCommand\('mermaidTree\.openSettings'[^]*?workbench\.action\.openSettings[^]*?@ext:/);
});

test('meny: sök i trädet från panelens rubrik, och rensa sökningen bara när man söker', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const title = id => pkg.contributes.commands.find(c => c.command === id)?.title;
  assert.equal(title('mermaidTree.search'), 'Search Tree…');
  assert.equal(title('mermaidTree.clearSearch'), 'Clear Search');
  const menu = pkg.contributes.menus['view/title'];
  const search = menu.find(m => m.command === 'mermaidTree.search');
  const clear = menu.find(m => m.command === 'mermaidTree.clearSearch');
  assert.match(search.when, /view == mermaidTree\.structure/);
  assert.match(clear.when, /view == mermaidTree\.structure && mermaidTree\.searching/);
  // Ctrl+Alt+F är redan VS Codes egen filtrering i träd; vi tar inte över den.
  const keys = pkg.contributes.keybindings ?? [];
  assert.ok(!keys.some(k => /ctrl\+alt\+f/i.test(k.key)));
});

test('inställningar: tema och temafärger för förhandsvisningen, auto som standard', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const props = pkg.contributes.configuration.properties;
  const theme = props['mermaidTree.preview.theme'];
  assert.deepEqual(theme.enum, ['auto', 'default', 'dark', 'forest', 'neutral', 'base',
    'neo', 'neo-dark', 'redux', 'redux-dark', 'redux-color', 'redux-dark-color']);
  assert.equal(theme.default, 'auto');
  assert.equal(theme.enumDescriptions.length, theme.enum.length);
  // Temamenyn i förhandsvisningen har samma val som inställningen, i VS Code och i testsidan.
  const options = html => [...(/<select id="theme"[^>]*>([\s\S]*?)<\/select>/.exec(html) ?? [, ''])[1].matchAll(/<option>([^<]+)<\/option>/g)].map(m => m[1]);
  assert.deepEqual(options(fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8')), theme.enum);
  assert.deepEqual(options(fs.readFileSync(path.join(root, 'media', 'harness.html'), 'utf8')), theme.enum);
  const vars = props['mermaidTree.preview.themeVariables'];
  assert.equal(vars.type, 'object');
  assert.deepEqual(vars.default, {});
  // Förhandsvisningen får inställningarna med varje diagram och ritas om när de ändras.
  const src = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
  assert.match(src, /type: 'render'[^\n]*theme/);
  assert.match(src, /affectsConfiguration\('mermaidTree\.preview'\)/);
});

test('kombinera klassdiagram: kommando i paletten och i högerklicksmenyn för klassdiagram, skrivskyddad vy', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const src = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
  const id = 'mermaidTree.combineClassDiagrams';
  assert.equal(pkg.contributes.commands.find(c => c.command === id)?.title, 'Combine Class Diagrams…');
  assert.match(pkg.contributes.menus['editor/context'].find(m => m.command === id)?.when ?? '', /mermaidTree\.classDiagram/);
  assert.ok(src.includes(`registerCommand('${id}'`));
  assert.match(src, /setContext', 'mermaidTree\.classDiagram'/);
  // Vyn är ett skrivskyddat dokument från en innehållsleverantör: källfilerna ändras aldrig härifrån.
  assert.match(src, /registerTextDocumentContentProvider\(COMBINED_SCHEME/);
});
