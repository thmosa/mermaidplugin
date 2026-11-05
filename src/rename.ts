// Byt namn på ett id (F2): hitta id:t vid markören och alla ställen där det används.
// Rena funktioner utan vscode. Etiketter, meddelanden, anteckningar och kommentarer
// maskas bort först, så att bara riktiga användningar av id:t byts.

import { DiagramModel } from './parser';

const ID_CHAR = String.raw`[\p{L}\p{N}_$]`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blank = (m: string) => ' '.repeat(m.length);
/** Behåll bara delen [start, end) av raden; resten blir mellanslag. */
const keepOnly = (line: string, start: number, end: number) => blank(line.slice(0, start)) + line.slice(start, end) + blank(line.slice(end));
/** Maska allt efter första ordet efter nyckelordet (style A fill:… → bara A kvar). */
const keepFirstArg = (line: string) => {
  const m = /^(\s*\S+\s+)(\S+)/.exec(line);
  return m ? keepOnly(line, m[1].length, m[1].length + m[2].length) : blank(line);
};
/** Maska sista ordet (class A,B hot → hot är en CSS-klass, inget id). */
const maskLastWord = (line: string) => line.replace(/\S+\s*$/, blank);

const RESERVED = new Set([
  'end', 'graph', 'flowchart', 'subgraph', 'direction', 'style', 'linkstyle', 'classdef', 'class', 'click', 'default',
  'state', 'note', 'statediagram', 'participant', 'actor', 'loop', 'alt', 'else', 'opt', 'par', 'and', 'critical',
  'option', 'break', 'rect', 'box', 'title', 'autonumber', 'activate', 'deactivate', 'create', 'destroy', 'link', 'links',
  'sequencediagram', 'classdiagram', 'namespace', 'cssclass', 'callback',
]);

type Kind = 'flow' | 'state' | 'sequence' | 'class';
const kindOf = (diagramType: string): Kind =>
  /^stateDiagram/.test(diagramType) ? 'state' : diagramType === 'sequenceDiagram' ? 'sequence' : /^classDiagram/.test(diagramType) ? 'class' : 'flow';

/** Varje rad med allt som inte kan vara ett id ersatt med mellanslag, så att kolumnerna behålls. */
export function maskedLines(text: string, diagramType: string): string[] {
  const kind = kindOf(diagramType);
  const src = text.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  if (src[0]?.trim() === '---') {
    out.push(blank(src[0]));
    for (i = 1; i < src.length; i++) {
      out.push(blank(src[i]));
      if (src[i].trim() === '---') { i++; break; }
    }
  }
  let header = false;
  let inNote = false;
  let inBody = false;
  for (; i < src.length; i++) {
    const line = src[i];
    const t = line.trim();
    if (t === '' || t.startsWith('%%') || !header) {
      if (t !== '' && !t.startsWith('%%')) header = true;
      out.push(blank(line));
      continue;
    }
    // Fri text över flera rader: anteckningar i state, klasskroppar i class.
    if (inNote) { out.push(blank(line)); if (/^end\s+note$/.test(t)) inNote = false; continue; }
    if (inBody) { out.push(blank(line)); if (t === '}') inBody = false; continue; }
    out.push(maskLine(line, t, kind, () => { inNote = true; }, () => { inBody = true; }));
  }
  return out;
}

function maskLine(line: string, t: string, kind: Kind, startNote: () => void, startBody: () => void): string {
  if (/^(classDef|linkStyle|direction|accTitle|accDescr)\b/.test(t)) return blank(line);
  if (/^(style|click|callback|link)\b/.test(t) && kind !== 'sequence') return keepFirstArg(line.replace(/"[^"]*"/g, blank));
  if (kind === 'class' && /^cssClass\b/.test(t)) {
    // cssClass "A,B" hot: id:na står inom citattecknen.
    const q = /"([^"]*)"/.exec(line);
    return q ? keepOnly(line, q.index + 1, q.index + 1 + q[1].length) : blank(line);
  }
  let out = line.replace(/"[^"]*"/g, blank);
  switch (kind) {
    case 'flow':
      if (/^class\b/.test(t)) return maskLastWord(out);
      out = out.replace(/\|[^|]*\|/g, blank).replace(/:::[\w-]+/g, blank);
      // Nodformer: A[text], A(text), A{text}, A>text] … innehållet är etikett, inte id.
      out = out.replace(/(?<=[\p{L}\p{N}_$])[[({>][^\])}]*[\])}]+/gu, blank);
      // Text på länken: A -- text --> B, A == text ==> B, A -. text .-> B.
      out = out.replace(/(?<=(?:^|[^-=.<])(?:--|==|-\.))\s[^-=.>]*?\s(?=--|==|\.-)/g, blank);
      return out;
    case 'state':
      if (/^class\b/.test(t)) return maskLastWord(out);
      if (/^note\s+(left|right)\s+of\s+[^:]+$/.test(t)) startNote();
      return out.replace(/(?<!:):(?!:).*$/, blank).replace(/:::[\w-]+/g, blank);
    case 'sequence':
      if (/^(title|autonumber)\b/.test(t)) return blank(line);
      // loop/alt/… och box: resten av raden är en titel eller färg.
      if (/^(loop|alt|else|opt|par_over|par|and|critical|option|break|rect|box)\b/.test(t)) {
        return out.replace(/^(\s*\S+)(.*)$/, (_m, kw: string, rest: string) => blank(kw) + blank(rest));
      }
      out = out.replace(/(?<!:):(?!:).*$/, blank).replace(/@\{.*\}/, blank);
      // participant API as Mitt API: aliaset är text.
      return out.replace(/^(\s*(?:create\s+)?(?:participant|actor)\s+\S+)(\s+as\s+.*)$/, (_m, head: string, alias: string) => head + blank(alias));
    case 'class':
      if (/^namespace\b/.test(t)) return blank(line);
      if (/^class\s/.test(t) && /\{\s*$/.test(t) && !/\{\s*\}\s*$/.test(t)) startBody();
      return out.replace(/<<[^>]*>>/g, blank).replace(/~[^~\s]*~/g, blank).replace(/:::[\w-]+/g, blank).replace(/(?<!:):(?!:).*$/, blank);
  }
}

// ---------------------------------------------------------------- namespaces i class diagram

interface Segment { path: string; line: number; start: number; end: number }

/** Varje namnsegment i namespace-deklarationer, med hela sökvägen det står för. */
function namespaceSegments(text: string): Segment[] {
  const src = text.split(/\r?\n/);
  const stack: string[] = [];
  const out: Segment[] = [];
  let inBody = false;
  src.forEach((line, k) => {
    const t = line.trim();
    if (inBody) { if (t === '}') inBody = false; return; }
    const ns = /^(\s*namespace\s+)(\S+?)(\s*\{\s*)$/.exec(line);
    if (ns) {
      let path = stack[stack.length - 1];
      let col = ns[1].length;
      for (const part of ns[2].split('.')) {
        path = path ? `${path}.${part}` : part;
        out.push({ path, line: k, start: col, end: col + part.length });
        col += part.length + 1;
      }
      stack.push(path!);
      return;
    }
    if (/^class\s/.test(t) && /\{\s*$/.test(t) && !/\{\s*\}\s*$/.test(t)) { inBody = true; return; }
    if (t === '}' && stack.length) stack.pop();
  });
  return out;
}

// ---------------------------------------------------------------- id:n

const isClass = (m: DiagramModel) => /^classDiagram/.test(m.diagramType);

/** Id:n som går att byta namn på: noder (utan [*]) och grupper med riktiga namn. */
export function renamable(model: DiagramModel): string[] {
  const ids = [...model.nodes.values()].filter(n => !n.pseudo).map(n => n.id);
  // Box och block i sequence har påhittade id:n (box0, block1).
  if (model.diagramType !== 'sequenceDiagram') ids.push(...model.subgraphs.keys());
  return ids;
}

export interface IdRange { id: string; line: number; start: number; end: number }

/** Id:t som står vid markören, om det är ett id som går att byta namn på. */
export function idAt(text: string, model: DiagramModel, line: number, character: number): IdRange | undefined {
  if (!model.supported) return undefined;
  if (isClass(model)) {
    const seg = namespaceSegments(text).find(s => s.line === line && s.start <= character && character <= s.end);
    if (seg) return { id: seg.path, line, start: seg.start, end: seg.end };
  }
  const masked = maskedLines(text, model.diagramType)[line] ?? '';
  const word = new RegExp(`${ID_CHAR}+`, 'gu');
  for (const m of masked.matchAll(word)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (character < start || character > end) continue;
    const ids = renamable(model).filter(id => !(isClass(model) && model.subgraphs.has(id)));
    return ids.includes(m[0]) ? { id: m[0], line, start, end } : undefined;
  }
  return undefined;
}

/** Alla ställen där id:t används. */
export function occurrences(text: string, model: DiagramModel, id: string): IdRange[] {
  if (isClass(model) && model.subgraphs.has(id)) {
    return namespaceSegments(text).filter(s => s.path === id).map(s => ({ id, line: s.line, start: s.start, end: s.end }));
  }
  const re = new RegExp(`(?<!${ID_CHAR}|${ID_CHAR}[.-])${escape(id)}(?!${ID_CHAR}|[.-]${ID_CHAR})`, 'gu');
  const out: IdRange[] = [];
  maskedLines(text, model.diagramType).forEach((masked, line) => {
    for (const m of masked.matchAll(re)) out.push({ id, line, start: m.index!, end: m.index! + id.length });
  });
  return out;
}

/**
 * Det som är dolt och hopfällt sparas med id:n (n:Order, e:Order->Kund#0, c:A.B). Efter ett
 * namnbyte ska nycklarna peka på det nya namnet; newId är hela nya id:t (för namespaces sökvägen).
 */
export function renameKeys(hidden: Iterable<string>, oldId: string, newId: string): Set<string> {
  const id = (x: string) => x === oldId ? newId : x.startsWith(`${oldId}.`) ? newId + x.slice(oldId.length) : x;
  const out = new Set<string>();
  for (const key of hidden) {
    const [prefix, rest] = [key.slice(0, 2), key.slice(2)];
    const edge = prefix === 'e:' && /^(.*)->(.*)(#\d+)$/.exec(rest);
    out.add(edge ? `e:${id(edge[1])}->${id(edge[2])}${edge[3]}` : prefix + id(rest));
  }
  return out;
}

/** Hela nya id:t: för en namespace byts bara sista segmentet i sökvägen. */
export function renamedId(model: DiagramModel, id: string, newName: string): string {
  const ns = isClass(model) && model.subgraphs.has(id) && id.includes('.');
  return ns ? `${id.slice(0, id.lastIndexOf('.'))}.${newName}` : newName;
}

export type RenameResult ={ edits: IdRange[]; error?: undefined } | { edits?: undefined; error: string };

/** Ändringarna för att byta namn på id, eller varför det inte går. */
export function rename(text: string, model: DiagramModel, id: string, newName: string): RenameResult {
  if (!renamable(model).includes(id)) return { error: `"${id}" is not a name that can be renamed.` };
  if (newName === id) return { edits: [] };
  if (!/^[\p{L}\p{N}_]+$/u.test(newName)) return { error: 'Use only letters, digits and _ in a name.' };
  if (RESERVED.has(newName.toLowerCase())) return { error: `"${newName}" is a reserved word in Mermaid.` };

  // En namespace byter bara sitt sista segment; jämför med hela sökvägen.
  const target = renamedId(model, id, newName);
  const others = renamable(model).filter(x => x !== id);
  if (others.includes(target)) return { error: `"${newName}" already exists in the diagram.` };
  const similar = others.find(x => x.toLowerCase() === target.toLowerCase());
  if (similar) return { error: `"${newName}" differs only in letter case from "${similar}". Mermaid treats them as different names.` };

  return { edits: occurrences(text, model, id) };
}
