// Tokeniserar med samma motor som VS Code (vscode-textmate + Oniguruma) och tilläggets grammatik,
// så att testerna ser exakt vilka scopes, och därmed vilka färger, texten får.
const fs = require('node:fs');
const path = require('node:path');
const { Registry, INITIAL } = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const GRAMMAR = path.join(__dirname, '..', '..', 'syntaxes', 'mermaid.tmLanguage.json');
let grammar;

async function load() {
  if (grammar) return grammar;
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner: p => new oniguruma.OnigScanner(p), createOnigString: s => new oniguruma.OnigString(s) }),
    loadGrammar: async scope => scope === 'source.mermaid'
      ? JSON.parse(fs.readFileSync(GRAMMAR, 'utf8'))
      : null,
  });
  grammar = await registry.loadGrammar('source.mermaid');
  return grammar;
}

/** Varje rads token: [{ line, start, end, text, scopes }]. */
async function tokenize(text) {
  const g = await load();
  let stack = INITIAL;
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const r = g.tokenizeLine(line, stack);
    stack = r.ruleStack;
    for (const t of r.tokens) {
      out.push({ line: i, start: t.startIndex, end: Math.min(t.endIndex, line.length), text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes });
    }
  });
  return out;
}

module.exports = { tokenize };
