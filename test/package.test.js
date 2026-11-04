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
  const extra = files.filter(f => /^(src|test|samples|\.vscode)\//.test(f) || f.endsWith('.map') || f === 'media/harness.html'
    || (f.startsWith('node_modules/') && !f.startsWith('node_modules/mermaid/dist/')));
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
