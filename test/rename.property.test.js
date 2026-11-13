// Egenskapstest: att byta namn på ett id ska ge exakt samma diagram, bara med det nya namnet.
// Körs för varje id i varje exempelfil. Parsern är facit, så etiketter, meddelanden och
// kommentarer som råkar innehålla id:t får inte ändras.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rename } = require('../out/rename');
const { parseDiagram } = require('../out/diagram');

const SAMPLES = path.join(__dirname, '..', 'samples');
const samples = fs.readdirSync(SAMPLES).filter(f => f.endsWith('.mmd'))
  .map(f => ({ name: f, text: fs.readFileSync(path.join(SAMPLES, f), 'utf8') }))
  .filter(s => parseDiagram(s.text).supported);

function apply(text, edits, newName) {
  const lines = text.split(/\r?\n/);
  for (const e of [...edits].sort((a, b) => b.line - a.line || b.start - a.start)) {
    lines[e.line] = lines[e.line].slice(0, e.start) + newName + lines[e.line].slice(e.end);
  }
  return lines.join('\n');
}

/**
 * Modellen som jämförbar data, med id:n översatta via sub. Etiketten och titeln översätts bara på det
 * element som byter namn, och inte när de är skrivna som text inom citattecken på sin rad
 * (state "Zorbel" as Zorbel). En beskrivning eller titel på något annat som råkar vara lika med
 * id:t (Tarnex : Pelmora) är också text och ska stå kvar.
 */
function shape(model, sub = x => x, text = '') {
  const lines = text.split(/\r?\n/);
  const subText = (id, value, line) => sub(id) !== id && !(lines[line] ?? '').includes(`"${value}"`) ? sub(value) : value;
  return {
    nodes: [...model.nodes.values()].map(n => [sub(n.id), subText(n.id, n.label, n.line), n.line, n.subgraph && sub(n.subgraph)]).sort(),
    edges: model.edges.map(e => [sub(e.from), sub(e.to), e.label, e.line]),
    subgraphs: [...model.subgraphs.values()].map(s => [sub(s.id), subText(s.id, s.title, s.line), s.line, s.endLine, s.parent && sub(s.parent)]).sort(),
  };
}

/** Hur id:t syns i modellen efter bytet: som id, i [*]-id:n, i etiketter som är id:t och i namespace-sökvägar. */
function substitution(model, id, newName) {
  const ns = /^classDiagram/.test(model.diagramType) && model.subgraphs.has(id);
  const target = ns && id.includes('.') ? `${id.slice(0, id.lastIndexOf('.'))}.${newName}` : newName;
  const title = ns ? id.slice(id.lastIndexOf('.') + 1) : id;
  return x => {
    if (x === id) return target;
    if (x === `${id}_start` || x === `${id}_end`) return `${target}${x.slice(id.length)}`;
    if (ns && x.startsWith(`${id}.`)) return target + x.slice(id.length);
    if (ns && x === title) return newName;
    // Generics: etiketten Cage<T> för klassen Cage.
    if (x.startsWith(`${id}<`)) return target + x.slice(id.length);
    return x;
  };
}

for (const { name, text } of samples) {
  test(`byt namn ${name}: varje id ger samma diagram med det nya namnet`, () => {
    const model = parseDiagram(text);
    const ids = [...model.nodes.values()].filter(n => !n.pseudo).map(n => n.id);
    if (model.diagramType !== 'sequenceDiagram') ids.push(...model.subgraphs.keys());
    assert.ok(ids.length > 0);
    for (const id of ids) {
      const newName = 'Nytt_namn9';
      const r = rename(text, model, id, newName);
      assert.equal(r.error, undefined, `${id}: ${r.error}`);
      const after = parseDiagram(apply(text, r.edits, newName));
      assert.deepEqual(shape(after), shape(model, substitution(model, id, newName), text), `${name}: ${id}`);
    }
  });
}
