// Lättviktig parser för Mermaid classDiagram. Ger samma modell som de andra parsrarna:
// klasser blir noder, relationer kanter och namespaces grupper. Filtreringen skriver om
// texten rad för rad och undviker det som kraschar Mermaid eller skapar dolda klasser igen:
// annotationer på okända klasser, medlemsrader och tomma namespaces.

import { DiagramModel, FlowNode, visibility, collapse, collapsedLabel } from './parser';

type Line =
  | { kind: 'raw'; text: string }
  | { kind: 'decl'; text: string; id: string }
  | { kind: 'bodyStart'; text: string; id: string }
  | { kind: 'body'; text: string; id: string }
  | { kind: 'bodyEnd'; text: string; id: string }
  | { kind: 'member'; text: string; id: string }
  | { kind: 'annotation'; text: string; id: string }
  | { kind: 'noteFor'; text: string; id: string }
  | { kind: 'rel'; text: string; indent: string; fromCard?: string; arrow: string; toCard?: string; label?: string }
  | { kind: 'nsStart'; text: string; id: string }
  | { kind: 'nsEnd'; text: string };

export interface ClassModel extends DiagramModel {
  lines: Line[];
}

// Ändar: <| * o < () till vänster, |> * o > () till höger; linjen är -- eller ..
// o kräver mellanslag mot klassnamnet så att Foo--Bar inte läses som F o-- Bar.
const ARROW = String.raw`(?:<\||\*|(?<=\s)o|<|\(\))?(?:--|\.\.)(?:\|>|\*|o(?=\s)|>|\(\))?`;
const END = String.raw`([^\s"]+?)`;
const REL_RE = new RegExp(`^${END}\\s*(?:"([^"]*)"\\s*)?(${ARROW})\\s*(?:"([^"]*)"\\s*)?([^\\s":]+)\\s*(?::\\s*(.*))?$`);
const CLASS_RE = /^class\s+([^\s~[{:]+)(~[^\s[{:]*~)?(?:\["([^"]*)"\])?(?::::[\w-]+)?\s*(\{\s*\}|\{)?\s*$/;

const indentOf = (text: string) => text.slice(0, text.length - text.trimStart().length);
/** Klassens id utan generics: Cage~T~ blir Cage. */
const classId = (name: string) => name.replace(/~.*~$/, '');

export function parseClass(text: string): ClassModel {
  const src = text.split(/\r?\n/);
  const model: ClassModel = { supported: false, diagramType: '', nodes: new Map(), edges: [], subgraphs: new Map(), lines: [] };
  const firstLine = new Map<string, number>();
  const defLine = new Map<string, number>();
  const labels = new Map<string, string>();
  const membership = new Map<string, string>();
  const pairCount = new Map<string, number>();
  const ns: string[] = [];
  let body: string | undefined;

  const mention = (id: string, line: number) => { if (!firstLine.has(id)) firstLine.set(id, line); };
  const declare = (id: string, line: number, label?: string) => {
    mention(id, line);
    if (!defLine.has(id)) defLine.set(id, line);
    if (label !== undefined) labels.set(id, label);
    if (ns.length && !membership.has(id)) membership.set(id, ns[ns.length - 1]);
  };

  let i = 0;
  if (src[0]?.trim() === '---') {
    model.lines.push({ kind: 'raw', text: src[0] });
    for (i = 1; i < src.length; i++) {
      model.lines.push({ kind: 'raw', text: src[i] });
      if (src[i].trim() === '---') { i++; break; }
    }
  }

  let headerSeen = false;
  for (; i < src.length; i++) {
    const text = src[i];
    const t = text.trim();
    if (body !== undefined) {
      if (t === '}') { model.lines.push({ kind: 'bodyEnd', text, id: body }); body = undefined; }
      else model.lines.push({ kind: 'body', text, id: body });
      continue;
    }
    if (t === '' || t.startsWith('%%')) { model.lines.push({ kind: 'raw', text }); continue; }

    if (!headerSeen) {
      headerSeen = true;
      model.diagramType = /^(\w[\w-]*)/.exec(t)?.[1] ?? '';
      model.supported = /^classDiagram(-v2)?$/.test(model.diagramType);
      model.lines.push({ kind: 'raw', text });
      if (!model.supported) {
        for (let k = i + 1; k < src.length; k++) model.lines.push({ kind: 'raw', text: src[k] });
        break;
      }
      continue;
    }

    const nsStart = /^namespace\s+(\S+)\s*\{\s*$/.exec(t);
    if (nsStart) {
      // namespace A.B ger både A och A.B; inuti A ger namespace B id:t A.B.
      let id = ns[ns.length - 1];
      for (const part of nsStart[1].split('.')) {
        const parent = id;
        id = parent ? `${parent}.${part}` : part;
        if (!model.subgraphs.has(id)) model.subgraphs.set(id, { id, title: part, line: i, endLine: i, parent });
      }
      ns.push(id!);
      model.lines.push({ kind: 'nsStart', text, id: id! });
      continue;
    }
    if (t === '}' && ns.length) {
      // namespace A.B stängs med ett enda }, så alla dess nivåer slutar här.
      const id = ns.pop()!;
      for (let cur: string | undefined = id; cur && cur !== ns[ns.length - 1]; cur = model.subgraphs.get(cur)?.parent) {
        model.subgraphs.get(cur)!.endLine = i;
      }
      model.lines.push({ kind: 'nsEnd', text });
      continue;
    }

    const cls = CLASS_RE.exec(t);
    if (cls) {
      const id = cls[1];
      // Mermaid visar Cage~T~ som Cage<T>.
      const label = cls[3] ?? (cls[2] ? `${id}${cls[2].replace(/^~/, '<').replace(/~$/, '>')}` : undefined);
      declare(id, i, label);
      if (cls[4] === '{') { body = id; model.lines.push({ kind: 'bodyStart', text, id }); }
      else model.lines.push({ kind: 'decl', text, id });
      continue;
    }

    const annotation = /^<<.+?>>\s*(\S+)$/.exec(t);
    if (annotation) { mention(annotation[1], i); model.lines.push({ kind: 'annotation', text, id: annotation[1] }); continue; }

    const note = /^note\s+for\s+(\S+)\s/.exec(t);
    if (note) { model.lines.push({ kind: 'noteFor', text, id: note[1] }); continue; }

    const rel = REL_RE.exec(t);
    if (rel) {
      const [, rawFrom, fromCard, arrow, toCard, rawTo, label] = rel;
      const from = classId(rawFrom);
      const to = classId(rawTo);
      // Lollipop-sidan () är ett gränssnitt och ingen klass.
      if (!arrow.startsWith('()')) mention(from, i);
      if (!arrow.endsWith('()')) mention(to, i);
      const pair = `${from}->${to}`;
      const n = pairCount.get(pair) ?? 0;
      pairCount.set(pair, n + 1);
      model.edges.push({ key: `${pair}#${n}`, index: model.edges.length, from, to, label: label?.trim() ?? '', line: i });
      model.lines.push({ kind: 'rel', text, indent: indentOf(text), fromCard, arrow, toCard, label });
      continue;
    }

    const member = /^([^\s:"<>]+)\s*:\s*(.*)$/.exec(t);
    if (member) {
      const id = classId(member[1]);
      mention(id, i);
      model.lines.push({ kind: 'member', text, id });
      continue;
    }

    model.lines.push({ kind: 'raw', text });
  }

  for (const [id, line] of firstLine) {
    const node: FlowNode = { id, label: labels.get(id) ?? id, line: defLine.get(id) ?? line, subgraph: membership.get(id) };
    model.nodes.set(id, node);
  }
  return model;
}

/** Bygger diagramtext utan dolda element. Oförändrade rader lämnas exakt som de var. */
export function filterClass(model: ClassModel, hidden: ReadonlySet<string>): string {
  if (!model.supported || hidden.size === 0) return model.lines.map(l => l.text).join('\n');
  const vis = visibility(model, hidden);
  const col = collapse(model, hidden);
  // En klass i en hopfälld namespace ritas av namespacets ersättningsklass.
  const absorbed = (id: string) => col.owner(id) !== undefined;
  const gone = (id: string) => vis.isNodeHidden(id) || absorbed(id);

  // Klasser som syns på annat håll behöver ingen extra deklaration när en relation försvinner.
  const shown = new Set<string>();
  for (const l of model.lines) {
    if ((l.kind === 'decl' || l.kind === 'bodyStart' || l.kind === 'member' || l.kind === 'annotation') && !gone(l.id)) shown.add(l.id);
  }
  for (const k of col.kept.values()) { shown.add(k.from); shown.add(k.to); }

  // Namespaces buffras; en namespace utan innehåll kvar tas bort helt.
  interface Frame { header?: string; buf: string[]; content: boolean }
  const frames: Frame[] = [{ buf: [], content: false }];
  const top = () => frames[frames.length - 1];
  const content = (text: string) => { top().buf.push(text); top().content = true; };
  const rootIndent = indentOf(model.lines.find((l, k) => k > 0 && l.text.trim() !== '' && l.kind !== 'raw')?.text ?? '  ') || '  ';

  let skip = 0;
  let edgeIdx = 0;
  for (const line of model.lines) {
    // Inne i en dold eller hopfälld namespace: bara relationerna räknas.
    if (skip > 0) {
      if (line.kind === 'nsStart') skip++;
      if (line.kind === 'nsEnd') skip--;
      if (line.kind === 'rel') edgeIdx++;
      continue;
    }
    switch (line.kind) {
      case 'raw':
        top().buf.push(line.text);
        break;
      case 'decl':
      case 'bodyStart':
      case 'body':
      case 'bodyEnd':
      case 'member':
      case 'annotation':
      case 'noteFor':
        if (!gone(line.id)) content(line.text);
        break;
      case 'nsStart': {
        if (vis.isSubgraphHidden(line.id) || (absorbed(line.id) && col.owner(line.id) !== line.id)) { skip = 1; break; }
        if (col.owner(line.id) === line.id) {
          // Hopfälld: en klass med namespacets id i stället för hela blocket.
          const n = col.count(line.id);
          if (n > 0) content(`${indentOf(line.text)}class ${line.id}["${collapsedLabel(model.subgraphs.get(line.id)!.title, n)}"]`);
          skip = 1;
          break;
        }
        frames.push({ header: line.text, buf: [], content: false });
        break;
      }
      case 'nsEnd': {
        const f = frames.length > 1 ? frames.pop()! : undefined;
        if (f?.content) { top().buf.push(f.header!, ...f.buf, line.text); top().content = true; }
        break;
      }
      case 'rel': {
        const e = model.edges[edgeIdx++];
        const kept = col.kept.get(e.index);
        if (!kept) {
          for (const id of [e.from, e.to]) {
            if (!model.nodes.has(id) || gone(id) || shown.has(id)) continue;
            frames[0].buf.push(`${rootIndent}class ${id}`);
            shown.add(id);
          }
          break;
        }
        if (!kept.remapped) { content(line.text); break; }
        const card = (c?: string) => c === undefined ? '' : `"${c}" `;
        content(`${line.indent}${kept.from} ${card(line.fromCard)}${line.arrow} ${card(line.toCard)}${kept.to}${line.label !== undefined ? ` : ${line.label.trim()}` : ''}`);
        break;
      }
    }
  }
  return frames[0].buf.join('\n');
}
