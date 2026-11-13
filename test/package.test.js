// Paketet (.vsix): rätt filer, inga onödiga, och att det fungerar utan resten av node_modules.
// Filerna tas från `vsce ls`, alltså exakt det som skulle packas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
let files;
test.before(() => {
  const vsce = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
  files = execFileSync(process.execPath, [vsce, 'ls'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/).map(f => f.trim()).filter(Boolean).map(f => f.replace(/\\/g, '/'));
});

test('paket: innehåller det tillägget behöver när det körs', () => {
  for (const f of [
    'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'language-configuration.json', 'syntaxes/mermaid.tmLanguage.json',
    'out/extension.js', 'out/mermaidCheck.js', 'media/preview.js', 'media/preview.css', 'media/zoom.js', 'media/labels.js', 'media/export.js', 'media/tree.svg',
    'node_modules/mermaid/dist/mermaid.min.js', 'node_modules/mermaid/dist/mermaid.esm.min.mjs',
  ]) assert.ok(files.includes(f), f);
});

test('paket: inga källfiler, tester, källkartor eller andra beroenden', () => {
  const extra = files.filter(f => /^(src|test|samples|images|\.vscode)\//.test(f) || f.endsWith('.map') || f === 'media/harness.html'
    || (f.startsWith('node_modules/') && !f.startsWith('node_modules/mermaid/dist/') && f !== 'node_modules/mermaid/LICENSE'));
  assert.deepEqual(extra, []);
  assert.ok(files.length < 200, `${files.length} filer`);
});

test('paket: syntaxkontrollen fungerar med bara paketets filer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mermaid-tree-vsix-'));
  try {
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.copyFileSync(path.join(root, f), path.join(dir, f));
    }
    const { checkSyntax } = require(path.join(dir, 'out', 'mermaidCheck.js'));
    assert.equal(await checkSyntax('flowchart LR\n  A --> B'), null);
    assert.equal((await checkSyntax('flowchart LR\n  A --> ')).kind, 'parse');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('paket: versionen stämmer med CHANGELOG och package-lock, och inget ligger kvar som "Unreleased"', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.equal(/^## (.+)$/m.exec(changelog)?.[1], pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});

// ------------------------------------------------------------ Marketplace

test('Marketplace: publisher SortaGameDev, inte privat, med sökord', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.publisher, 'SortaGameDev');
  assert.equal(pkg.private, undefined, '"private" hör till npm och ska inte stå i ett tillägg');
  for (const k of ['mermaid', 'diagram', 'state diagram', 'class diagram']) assert.ok(pkg.keywords?.includes(k), k);
});

test('Marketplace: ikonen är en PNG på minst 128×128 och följer med i paketet', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.icon && files.includes(pkg.icon), `ikon: ${pkg.icon}`);
  const png = fs.readFileSync(path.join(root, pkg.icon));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  // IHDR: bredd och höjd som 32-bitars tal efter signaturen och chunkhuvudet.
  const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.ok(w >= 128 && h >= 128 && w === h, `${w}×${h}`);
});

test('Marketplace: Mermaids licenstext följer med, eftersom Mermaid ingår i paketet', () => {
  assert.ok(files.includes('node_modules/mermaid/LICENSE'));
});
