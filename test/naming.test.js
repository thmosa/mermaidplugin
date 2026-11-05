// Namngivningsregler: id:n som inte följer vald stil (camelCase, PascalCase, snake_case)
// varnas, med förslag som byter namn via samma namnbyte som F2.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { toStyle, namingIssues, fixAll } = require('../out/naming');
const { parseDiagram } = require('../out/diagram');

test('namn: delas i ord vid _ och stora bokstäver, siffror hör till ordet före', () => {
  assert.equal(toStyle('order_service', 'camelCase'), 'orderService');
  assert.equal(toStyle('OrderService', 'camelCase'), 'orderService');
  assert.equal(toStyle('orderService', 'PascalCase'), 'OrderService');
  assert.equal(toStyle('OrderService', 'snake_case'), 'order_service');
  assert.equal(toStyle('W6_F2', 'camelCase'), 'w6F2');
  assert.equal(toStyle('W6_F2', 'snake_case'), 'w6_f2');
  assert.equal(toStyle('HTTPServer', 'camelCase'), 'httpServer');
  assert.equal(toStyle('orderID', 'snake_case'), 'order_id');
  assert.equal(toStyle('Användare', 'snake_case'), 'användare');
  assert.equal(toStyle('ÖppnaÄrende', 'camelCase'), 'öppnaÄrende');
});

test('namn: det som redan följer stilen ändras inte', () => {
  for (const [id, style] of [['orderService', 'camelCase'], ['OrderService', 'PascalCase'], ['order_service', 'snake_case'], ['a', 'camelCase'], ['A', 'PascalCase'], ['x1', 'snake_case']]) {
    assert.equal(toStyle(id, style), id, `${id} ${style}`);
  }
});

test('regler: av ger inga varningar', () => {
  const text = 'flowchart LR\n  order_service --> Kund';
  assert.deepEqual(namingIssues(text, parseDiagram(text), 'off'), []);
});

test('regler: varnar där id:t definieras, med förslag', () => {
  const text = 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> busy_now : go\n  state busy_now {\n    work\n  }';
  const issues = namingIssues(text, parseDiagram(text), 'PascalCase');
  assert.deepEqual(issues.map(i => [i.id, i.suggestion, i.line, i.start, i.end, i.fixable]),
    [['busy_now', 'BusyNow', 3, 8, 16, true], ['work', 'Work', 4, 4, 8, true]]);
  assert.match(issues[0].message, /busy_now.*PascalCase.*BusyNow/);
});

test('regler: [*], meddelandetexter och etiketter räknas inte, bara riktiga namn', () => {
  const text = 'sequenceDiagram\n  participant api_gw as API Gateway\n  api_gw->>Db: fetch_all rows\n  Note over Db: some_note';
  const issues = namingIssues(text, parseDiagram(text), 'camelCase');
  assert.deepEqual(issues.map(i => [i.id, i.suggestion, i.line]), [['api_gw', 'apiGw', 1], ['Db', 'db', 2]]);
});

test('regler: namespaces kontrolleras per segment', () => {
  const text = 'classDiagram\n  namespace shop.order_items {\n    class Cart\n  }';
  const issues = namingIssues(text, parseDiagram(text), 'PascalCase');
  assert.deepEqual(issues.map(i => [i.id, i.name, i.suggestion]), [['shop', 'shop', 'Shop'], ['shop.order_items', 'order_items', 'OrderItems']]);
});

test('regler: förslag som krockar med ett annat namn går inte att rätta automatiskt', () => {
  const text = 'flowchart LR\n  order_service --> orderService';
  const issues = namingIssues(text, parseDiagram(text), 'camelCase');
  assert.deepEqual(issues.map(i => [i.id, i.fixable]), [['order_service', false]]);
});

test('rätta alla: byter varje namn som går, och rapporterar bytena', () => {
  const text = 'flowchart LR\n  order_service --> Kund_Konto\n  Kund_Konto -->|order_service| x';
  const r = fixAll(text, 'camelCase');
  assert.equal(r.text, 'flowchart LR\n  orderService --> kundKonto\n  kundKonto -->|order_service| x');
  assert.deepEqual(r.renamed, [['order_service', 'orderService'], ['Kund_Konto', 'kundKonto']]);
  assert.deepEqual(namingIssues(r.text, parseDiagram(r.text), 'camelCase'), []);
});

test('rätta alla: namespaces och deras klasser i samma fil', () => {
  const text = 'classDiagram\n  namespace shop_ns {\n    class cart_item\n  }\n  cart_item --> other_one';
  const r = fixAll(text, 'PascalCase');
  assert.equal(r.text, 'classDiagram\n  namespace ShopNs {\n    class CartItem\n  }\n  CartItem --> OtherOne');
});

test('regler: inställningen finns i package.json, av som standard', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const setting = pkg.contributes.configuration.properties['mermaidTree.namingStyle'];
  assert.ok(setting, 'inställningen saknas');
  assert.deepEqual(setting.enum, ['off', 'camelCase', 'PascalCase', 'snake_case']);
  assert.equal(setting.default, 'off');
  assert.equal(setting.enumDescriptions.length, 4);
});

test('regler: "Fix All Naming Issues" finns i kommandopaletten och i editorns högerklicksmeny för mermaid', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const cmd = pkg.contributes.commands.find(c => c.command === 'mermaidTree.fixAllNaming');
  assert.equal(cmd?.title, 'Fix All Naming Issues');
  assert.equal(cmd.category, 'Mermaid Tree');
  const ctx = pkg.contributes.menus['editor/context'].find(m => m.command === 'mermaidTree.fixAllNaming');
  assert.match(ctx.when, /resourceLangId == mermaid/);
  // Bara när en stil är vald, annars finns inget att rätta.
  assert.match(ctx.when, /config\.mermaidTree\.namingStyle != off/);
  const palette = pkg.contributes.menus.commandPalette.find(m => m.command === 'mermaidTree.fixAllNaming');
  assert.match(palette.when, /editorLangId == mermaid/);
});

test('regler: rätta alla erbjuds som source.fixAll, så att det kan köras vid sparning', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
  assert.match(src, /CodeActionKind\.SourceFixAll\.append\('mermaidTree'\)/);
});
