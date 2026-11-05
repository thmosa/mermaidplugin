// Lättviktig parser för Mermaid state diagram (stateDiagram och stateDiagram-v2).
// Ger samma modell som flowchart-parsern: tillstånd blir noder, övergångar kanter
// och sammansatta tillstånd subgrafer. Så fungerar trädet, synligheten och
// grannsökningen oförändrade. Filtreringen skriver om texten rad för rad.

import { DiagramModel, FlowNode, cleanLabel, visibility, collapse, collapsedLabel } from './parser';

type Line =
  | { kind: 'raw'; text: string; sg?: string }
  | { kind: 'trans'; text: string; indent: string; sg?: string }
  | { kind: 'decl'; text: string; id: string; sg?: string }
  | { kind: 'note'; text: string; target: string; sg?: string }
  | { kind: 'class'; text: string; indent: string; ids: string[]; rest: string; sg?: string }
  | { kind: 'divider'; text: string; sg?: string }
  | { kind: 'compStart'; text: string; sg: string }
  | { kind: 'compEnd'; text: string; sg: string };

export interface StateModel extends DiagramModel {
  lines: Line[];
}

const ID = String.raw`[\p{L}\p{N}_$.]+(?:-[\p{L}\p{N}_$.]+)*`;
const END = String.raw`(?:\[\*\]|${ID})`;
const CLS = String.raw`(?::::[\w-]+)?`;
const TRANS_RE = new RegExp(`^(${END})${CLS}\\s*-->\\s*(${END})${CLS}\\s*(?::(.*))?$`, 'u');
const COMP_RE = new RegExp(`^state\\s+(?:"([^"]*)"\\s+as\\s+(${ID})|(${ID}))\\s*\\{$`, 'u');
const ALIAS_RE = new RegExp(`^state\\s+"([^"]*)"\\s+as\\s+(${ID})\\s*$`, 'u');
const SPECIAL_RE = new RegExp(`^state\\s+(${ID})\\s*<<(fork|join|choice)>>\\s*$`, 'u');
const BARE_STATE_RE = new RegExp(`^state\\s+(${ID})\\s*$`, 'u');
const DESC_RE = new RegExp(`^(${ID})\\s*:(.*)$`, 'u');
const BARE_RE = new RegExp(`^(${ID})${CLS}$`, 'u');
const NOTE_RE = new RegExp(`^note\\s+(?:left|right)\\s+of\\s+(${ID})\\s*(:.*)?$`, 'u');

export function parseState(text: string): StateModel {
  const src = text.split(/\r?\n/);
  const model: StateModel = { supported: false, diagramType: '', nodes: new Map(), edges: [], subgraphs: new Map(), lines: [] };
  const firstLine = new Map<string, number>();
  const defLine = new Map<string, number>();
  const labels = new Map<string, string>();
  const membership = new Map<string, string | undefined>();
  const pseudo = new Map<string, 'start' | 'end'>();
  const bareStateLine = new Map<string, number>();
  const pairCount = new Map<string, number>();
  const stack: string[] = [];

  let i = 0;
  if (src[0]?.trim() === '---') {
    model.lines.push({ kind: 'raw', text: src[0] });
    for (i = 1; i < src.length; i++) {
      model.lines.push({ kind: 'raw', text: src[i] });
      if (src[i].trim() === '---') { i++; break; }
    }
  }

  const mention = (id: string, line: number, sg: string | undefined) => {
    if (!firstLine.has(id)) firstLine.set(id, line);
    // Som Mermaid: det sista sammansatta tillståndet som nämner id:t äger det; utanför räknas bara om inget gör det.
    if (sg !== undefined || !membership.has(id)) membership.set(id, sg);
  };

  let headerSeen = false;
  for (; i < src.length; i++) {
    const text = src[i];
    const trimmed = text.trim();
    const indent = text.slice(0, text.length - text.trimStart().length);
    const sg = stack[stack.length - 1];

    if (trimmed === '' || trimmed.startsWith('%%')) { model.lines.push({ kind: 'raw', text, sg }); continue; }

    if (!headerSeen) {
      headerSeen = true;
      model.diagramType = /^(\w[\w-]*)/.exec(trimmed)?.[1] ?? '';
      model.supported = /^stateDiagram(-v2)?$/.test(model.diagramType);
      model.lines.push({ kind: 'raw', text });
      if (!model.supported) {
        for (let k = i + 1; k < src.length; k++) model.lines.push({ kind: 'raw', text: src[k] });
        break;
      }
      continue;
    }

    // Anteckning över flera rader: allt fram till "end note" är fri text.
    const note = NOTE_RE.exec(trimmed);
    if (note) {
      let block = text;
      if (!note[2]) {
        while (i + 1 < src.length) {
          block += '\n' + src[++i];
          if (src[i].trim() === 'end note') break;
        }
      }
      model.lines.push({ kind: 'note', text: block, target: note[1], sg });
      continue;
    }

    const comp = COMP_RE.exec(trimmed);
    if (comp) {
      const id = comp[2] ?? comp[3];
      model.subgraphs.set(id, { id, title: comp[1] ?? id, line: i, endLine: i, parent: sg });
      model.lines.push({ kind: 'compStart', text, sg: id });
      stack.push(id);
      continue;
    }
    if (trimmed === '}' && stack.length) {
      const id = stack.pop()!;
      model.subgraphs.get(id)!.endLine = i;
      model.lines.push({ kind: 'compEnd', text, sg: id });
      continue;
    }

    if (trimmed === '--') { model.lines.push({ kind: 'divider', text, sg }); continue; }

    const trans = TRANS_RE.exec(trimmed);
    if (trans) {
      const scope = sg ?? 'root';
      const end = (raw: string, kind: 'start' | 'end') => {
        if (raw !== '[*]') return raw;
        const id = `${scope}_${kind}`;
        pseudo.set(id, kind);
        return id;
      };
      const from = end(trans[1], 'start');
      const to = end(trans[2], 'end');
      for (const id of [from, to]) if (!model.subgraphs.has(id)) mention(id, i, sg);
      const pair = `${from}->${to}`;
      const n = pairCount.get(pair) ?? 0;
      pairCount.set(pair, n + 1);
      model.edges.push({ key: `${pair}#${n}`, index: model.edges.length, from, to, label: (trans[3] ?? '').trim(), line: i });
      model.lines.push({ kind: 'trans', text, indent, sg });
      continue;
    }

    const cls = /^class\s+(\S+)(.*)$/.exec(trimmed);
    if (cls) { model.lines.push({ kind: 'class', text, indent, ids: cls[1].split(','), rest: cls[2], sg }); continue; }

    const alias = ALIAS_RE.exec(trimmed);
    const special = SPECIAL_RE.exec(trimmed);
    const bareState = BARE_STATE_RE.exec(trimmed);
    const desc = /^(classDef|direction|accTitle|accDescr|title)\b/.test(trimmed) ? null : DESC_RE.exec(trimmed);
    const bare = BARE_RE.exec(trimmed);
    if (alias) {
      labels.set(alias[2], cleanLabel(alias[1]) || alias[2]);
      defLine.set(alias[2], i);
      mention(alias[2], i, sg);
      model.lines.push({ kind: 'decl', text, id: alias[2], sg });
    } else if (special) {
      defLine.set(special[1], i);
      mention(special[1], i, sg);
      model.lines.push({ kind: 'decl', text, id: special[1], sg });
    } else if (bareState) {
      // Mermaid ritar inte "state B" ensamt; B blir en nod först om den nämns på annat sätt.
      if (!bareStateLine.has(bareState[1])) bareStateLine.set(bareState[1], i);
      model.lines.push({ kind: 'decl', text, id: bareState[1], sg });
    } else if (desc && !/^(classDef|direction)$/.test(desc[1])) {
      mention(desc[1], i, sg);
      model.lines.push({ kind: 'decl', text, id: desc[1], sg });
    } else if (bare && !/^(classDef|direction|end)$/.test(bare[1])) {
      mention(bare[1], i, sg);
      model.lines.push({ kind: 'decl', text, id: bare[1], sg });
    } else {
      model.lines.push({ kind: 'raw', text, sg });
    }
  }

  for (const [id, line] of firstLine) {
    // Ett sammansatt tillstånd kan nämnas i en övergång innan blocket står; det är en subgraf.
    if (model.subgraphs.has(id)) continue;
    const kind = pseudo.get(id);
    const node: FlowNode = {
      id, label: kind ? (kind === 'start' ? 'Start' : 'End') : labels.get(id) ?? id,
      line: defLine.get(id) ?? Math.min(line, bareStateLine.get(id) ?? line), subgraph: membership.get(id),
    };
    if (kind) node.pseudo = kind;
    model.nodes.set(id, node);
  }
  return model;
}

/** Bygger diagramtext utan dolda element. Oförändrade rader lämnas exakt som de var. */
export function filterState(model: StateModel, hidden: ReadonlySet<string>): string {
  if (!model.supported || hidden.size === 0) return model.lines.map(l => l.text).join('\n');
  const vis = visibility(model, hidden);
  const col = collapse(model, hidden);
  // Övergångar som ritas, med ändar efter omdragning till hopfällda tillstånd.
  const drawnEdges = [...col.kept.values()];
  const insideCollapsed = (sg: string | undefined) => sg !== undefined && col.owner(sg) !== undefined;
  const absorbed = (id: string) => { const o = col.owner(id); return o !== undefined && o !== id; };

  // Sammansatta tillstånd utan något synligt tillstånd kvar tas bort ([*] räknas inte).
  const hasVisible = (id: string): boolean =>
    [...model.nodes.values()].some(n => n.subgraph === id && !n.pseudo && !vis.isNodeHidden(n.id)) ||
    [...model.subgraphs.values()].some(s => s.parent === id && hasVisible(s.id));
  const dropped = new Set([...model.subgraphs.keys()].filter(id => vis.isSubgraphHidden(id) || !hasVisible(id)));
  const inDropped = (sg: string | undefined) => {
    for (let cur = sg; cur; cur = model.subgraphs.get(cur)?.parent) if (dropped.has(cur)) return true;
    return false;
  };
  // Rader i ett hopfällt tillstånd ersätts av dess platshållare.
  const skip = (sg: string | undefined) => inDropped(sg) || insideCollapsed(sg);
  const gone = (id: string) => vis.isNodeHidden(id) || (model.subgraphs.has(id) && vis.isSubgraphHidden(id)) || absorbed(id);

  // Tillstånd som syns på annat håll behöver ingen extra deklaration när en övergång försvinner.
  const shown = new Set<string>();
  for (const e of drawnEdges) { shown.add(e.from); shown.add(e.to); }
  for (const l of model.lines) if (l.kind === 'decl' && model.nodes.has(l.id) && !gone(l.id) && !skip(l.sg)) shown.add(l.id);

  // Ritas id:t alls efter filtreringen? Klasser och anteckningar på något som inte ritas ger fel i Mermaid.
  const touched = new Set(drawnEdges.flatMap(e => [e.from, e.to]));
  const drawn = (id: string): boolean => {
    if (absorbed(id)) return false;
    const sg = model.subgraphs.get(id);
    if (sg) return !vis.isSubgraphHidden(id) && ((!dropped.has(id) && !inDropped(sg.parent)) || touched.has(id));
    const n = model.nodes.get(id);
    if (!n) return true;
    return !gone(id) && !inDropped(n.subgraph) && (!n.pseudo || touched.has(id));
  };

  // Avdelare (--) mellan parallella regioner skrivs först när nästa region får innehåll,
  // och bara om regionen före hade innehåll. Annars kraschar Mermaid på en tom region.
  const out: string[] = [];
  const regionHasContent = new Map<string | undefined, boolean>();
  const pendingDivider = new Map<string | undefined, string>();
  const emit = (text: string, sg: string | undefined) => {
    const divider = pendingDivider.get(sg);
    if (divider !== undefined) { out.push(divider); pendingDivider.delete(sg); }
    out.push(text);
    regionHasContent.set(sg, true);
  };

  let edgeIdx = 0;
  for (const line of model.lines) {
    switch (line.kind) {
      case 'compStart': {
        if (inDropped(line.sg)) break;
        const owner = col.owner(line.sg);
        const parent = model.subgraphs.get(line.sg)!.parent;
        if (owner === undefined) emit(line.text, parent);
        else if (owner === line.sg) {
          const indent = line.text.slice(0, line.text.length - line.text.trimStart().length);
          const title = model.subgraphs.get(line.sg)!.title;
          emit(`${indent}state "${collapsedLabel(title, col.count(line.sg))}" as ${line.sg}`, parent);
        }
        break;
      }
      case 'compEnd':
        pendingDivider.delete(line.sg);
        if (!skip(line.sg)) out.push(line.text);
        break;
      case 'divider':
        if (!skip(line.sg) && regionHasContent.get(line.sg)) {
          pendingDivider.set(line.sg, line.text);
          regionHasContent.set(line.sg, false);
        }
        break;
      case 'raw':
        if (!skip(line.sg)) out.push(line.text);
        break;
      case 'decl':
        if (!skip(line.sg) && !gone(line.id)) emit(line.text, line.sg);
        break;
      case 'note':
        if (!skip(line.sg) && drawn(line.target)) emit(line.text, line.sg);
        break;
      case 'class': {
        if (skip(line.sg)) break;
        const ids = line.ids.filter(drawn);
        if (ids.length === line.ids.length) out.push(line.text);
        else if (ids.length) out.push(`${line.indent}class ${ids.join(',')}${line.rest}`);
        break;
      }
      case 'trans': {
        const e = model.edges[edgeIdx++];
        if (skip(line.sg)) break;
        const k = col.kept.get(e.index);
        if (k && !k.remapped) { emit(line.text, line.sg); break; }
        if (k) {
          const end = (id: string) => (model.nodes.get(id)?.pseudo ? '[*]' : id);
          emit(`${line.indent}${end(k.from)} --> ${end(k.to)}${e.label ? ` : ${e.label}` : ''}`, line.sg);
          break;
        }
        for (const id of [e.from, e.to]) {
          const n = model.nodes.get(id);
          if (!n || n.pseudo || gone(id) || shown.has(id)) continue;
          emit(line.indent + id, line.sg);
          shown.add(id);
        }
        break;
      }
    }
  }
  return out.join('\n');
}
