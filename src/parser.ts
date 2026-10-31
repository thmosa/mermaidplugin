// Lättviktig parser för Mermaid-flowcharts. Den håller reda på källrader så att
// vi kan bygga arbetsträdet, hoppa till rätt rad och filtrera bort dolda element
// innan diagrammet skickas till Mermaid för rendering.

export interface FlowNode {
  id: string;
  label: string;
  /** Rad där noden definieras (med form) eller nämns första gången. 0-baserad. */
  line: number;
  /** Innersta subgrafen noden tillhör, om någon. */
  subgraph?: string;
  /** State diagram: start- eller slutpunkt ([*]). Ritas bara om någon synlig övergång rör den. */
  pseudo?: 'start' | 'end';
}

export interface FlowEdge {
  /** Stabil nyckel: "A->B#0" (n:te kanten mellan samma par). */
  key: string;
  /** Ordningsnummer i diagrammet, samma som Mermaid använder för linkStyle. */
  index: number;
  from: string;
  to: string;
  label: string;
  line: number;
}

export interface FlowSubgraph {
  id: string;
  title: string;
  line: number;
  endLine: number;
  parent?: string;
}

/** Det som trädet, synligheten och grannsökningen behöver, oavsett diagramtyp. */
export interface DiagramModel {
  supported: boolean;
  diagramType: string;
  nodes: Map<string, FlowNode>;
  edges: FlowEdge[];
  subgraphs: Map<string, FlowSubgraph>;
}

export interface FlowModel extends DiagramModel {
  lines: Line[];
}

interface NodeRef { id: string; text: string; hasShape: boolean }
interface LinkTok { text: string; label: string }
interface Stmt { groups: NodeRef[][]; links: LinkTok[] }

type Line =
  | { kind: 'raw'; text: string; sg?: string }
  | { kind: 'stmt'; text: string; indent: string; stmts: Stmt[]; sg?: string }
  | { kind: 'sgStart'; text: string; sg: string }
  | { kind: 'sgEnd'; text: string; sg: string }
  | { kind: 'ref'; text: string; indent: string; keyword: string; ids: string[]; rest: string; sg?: string }
  | { kind: 'linkStyle'; text: string; indent: string; indices: number[] | 'default'; rest: string; sg?: string };

// ---------------------------------------------------------------- scanning

const ID_RE = /[\p{L}\p{N}_$][\p{L}\p{N}_$.]*(?:-(?![-.>=ox])[\p{L}\p{N}_$.]+)*/uy;
const CLASS_RE = /:::[\w-]+/y;
const EDGE_ID = '(?:[\\p{L}\\p{N}_]+@)?';
const PLAIN_LINK_RE = new RegExp(`${EDGE_ID}[<ox]?(?:-{2,}[>ox]|-{3,}|={2,}[>ox]|={3,}|-\\.+-[>ox]?|~{3,})`, 'uy');
const PIPE_RE = /\s*\|([^|]*)\|/y;
const TEXT_LINK_RE = new RegExp(`${EDGE_ID}[<ox]?(--|==|-\\.)\\s+(.+?)\\s+(-{2,}[>ox]?|={2,}[>ox]?|\\.-+[>ox]?)(?![-=.])`, 'uy');

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

/** Hittar slutet på en balanserad parentes/hakparentes/klammer, med hänsyn till citattecken. */
function balanced(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"') {
      const close = s.indexOf('"', j + 1);
      if (close < 0) return -1;
      j = close;
      continue;
    }
    if (c === '[' || c === '(' || c === '{') depth++;
    else if (c === ']' || c === ')' || c === '}') {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

function stickyMatch(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(s);
}

export function cleanLabel(raw: string): string {
  let label = raw.replace(/^[\[\](){}>\/\\\s]+|[\[\](){}\/\\\s]+$/g, '').replace(/^"|"$/g, '');
  // Markdown-sträng ("`...`"): visa texten utan fetstil/kursiv-tecken.
  if (/^`[^]*`$/.test(label)) {
    label = label.slice(1, -1).replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/([*_])(.+?)\1/g, '$2');
  }
  return label.replace(/\s+/g, ' ').trim();
}

function parseNode(s: string, i: number): { ref: NodeRef; label: string; end: number } | null {
  i = skipWs(s, i);
  const m = stickyMatch(ID_RE, s, i);
  if (!m) return null;
  const id = m[0];
  let j = i + id.length;
  let label = id;
  let hasShape = false;
  if (s.startsWith('@{', j)) {
    const end = balanced(s, j + 1);
    if (end < 0) return null;
    const lm = /label\s*:\s*"([^"]*)"/.exec(s.slice(j, end));
    if (lm) label = lm[1];
    j = end;
    hasShape = true;
  } else if (s[j] === '[' || s[j] === '(' || s[j] === '{') {
    const end = balanced(s, j);
    if (end < 0) return null;
    label = cleanLabel(s.slice(j, end)) || id;
    j = end;
    hasShape = true;
  } else if (s[j] === '>') {
    const end = s.indexOf(']', j);
    if (end < 0) return null;
    label = cleanLabel(s.slice(j + 1, end)) || id;
    j = end + 1;
    hasShape = true;
  }
  const cm = stickyMatch(CLASS_RE, s, j);
  if (cm) j += cm[0].length;
  return { ref: { id, text: s.slice(i, j), hasShape }, label, end: j };
}

function parseLink(s: string, i: number): { tok: LinkTok; end: number } | null {
  i = skipWs(s, i);
  const plain = stickyMatch(PLAIN_LINK_RE, s, i);
  if (plain) {
    let end = i + plain[0].length;
    let label = '';
    const pipe = stickyMatch(PIPE_RE, s, end);
    if (pipe) {
      label = pipe[1];
      end += pipe[0].length;
    }
    return { tok: { text: s.slice(i, end), label: label.replace(/^"|"$/g, '').trim() }, end };
  }
  const text = stickyMatch(TEXT_LINK_RE, s, i);
  if (text) {
    return { tok: { text: text[0], label: text[2].replace(/^"|"$/g, '').trim() }, end: i + text[0].length };
  }
  return null;
}

type Labels = Map<string, string>;

function parseGroup(s: string, i: number, labels: Labels): { refs: NodeRef[]; end: number } | null {
  const refs: NodeRef[] = [];
  for (;;) {
    const n = parseNode(s, i);
    if (!n) return null;
    refs.push(n.ref);
    if (n.ref.hasShape || !labels.has(n.ref.id)) labels.set(n.ref.id, n.label);
    i = skipWs(s, n.end);
    if (s[i] !== '&') return { refs, end: i };
    i++;
  }
}

function parseStatement(s: string, labels: Labels): Stmt | null {
  const scratch: Labels = new Map();
  const first = parseGroup(s, 0, scratch);
  if (!first) return null;
  const stmt: Stmt = { groups: [first.refs], links: [] };
  let i = first.end;
  for (;;) {
    i = skipWs(s, i);
    if (i >= s.length) break;
    const link = parseLink(s, i);
    if (!link) return null;
    stmt.links.push(link.tok);
    const g = parseGroup(s, link.end, scratch);
    if (!g) return null;
    stmt.groups.push(g.refs);
    i = g.end;
  }
  // Etiketter sparas bara om hela satsen gick att tolka.
  for (const [id, label] of scratch) {
    if (!labels.has(id) || stmt.groups.some(g => g.some(r => r.id === id && r.hasShape))) labels.set(id, label);
  }
  return stmt;
}

/** Delar en rad på ';' som inte står inom citattecken eller parenteser. */
function splitStatements(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let pipe = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quote = !quote;
    else if (quote) continue;
    else if (c === '|') pipe = !pipe;
    else if (pipe) continue;
    else if ('[({'.includes(c)) depth++;
    else if ('])}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map(p => p.trim()).filter(p => p.length > 0);
}

// ---------------------------------------------------------------- parse

export function parseFlowchart(text: string): FlowModel {
  const src = text.split(/\r?\n/);
  const model: FlowModel = {
    supported: false, diagramType: '', nodes: new Map(), edges: [], subgraphs: new Map(), lines: [],
  };
  const labels: Labels = new Map();
  const firstLine = new Map<string, number>();
  const defLine = new Map<string, number>();
  const membership = new Map<string, string>();
  const pairCount = new Map<string, number>();

  // Subgrafer utan eget id får "subGraphN" av Mermaid, numrerat i den ordning de stängs.
  interface OpenSg { tmp: string; explicitId?: string; title: string; line: number; parent?: string }
  const stack: OpenSg[] = [];
  const tmpToId = new Map<string, string>();
  let tmpCounter = 0;
  let closeCounter = 0;
  const pending: { line: Line; tmp?: string }[] = [];

  let i = 0;
  if (src[0]?.trim() === '---') {
    pending.push({ line: { kind: 'raw', text: src[0] } });
    for (i = 1; i < src.length; i++) {
      pending.push({ line: { kind: 'raw', text: src[i] } });
      if (src[i].trim() === '---') { i++; break; }
    }
  }

  let headerSeen = false;
  let next = i;
  for (; i < src.length; i = next) {
    // En sträng inom citattecken kan sträcka sig över flera rader (t.ex. markdown-strängar).
    // Då behandlas raderna som en logisk rad; radnumret är där den börjar.
    let text = src[i];
    next = i + 1;
    if (!text.trim().startsWith('%%')) {
      while ((text.match(/"/g)?.length ?? 0) % 2 === 1 && next < src.length) text += '\n' + src[next++];
    }
    const trimmed = text.trim();
    const indent = text.slice(0, text.length - text.trimStart().length);
    const sgTmp = stack.length ? stack[stack.length - 1].tmp : undefined;
    const push = (line: Line) => pending.push({ line, tmp: sgTmp });

    if (trimmed === '' || trimmed.startsWith('%%')) { push({ kind: 'raw', text }); continue; }

    if (!headerSeen) {
      headerSeen = true;
      const hm = /^(\w[\w-]*)/.exec(trimmed);
      model.diagramType = hm ? hm[1] : '';
      model.supported = /^(flowchart|graph)\b/.test(trimmed);
      push({ kind: 'raw', text });
      if (!model.supported) {
        for (let k = next; k < src.length; k++) pending.push({ line: { kind: 'raw', text: src[k] } });
        break;
      }
      continue;
    }

    const word = /^(\w+)/.exec(trimmed)?.[1];

    if (word === 'subgraph') {
      const rest = trimmed.slice('subgraph'.length).trim();
      const m = /^([^\s\[]+)\s*(\[.*\])?$/.exec(rest);
      let explicitId: string | undefined;
      let title: string;
      if (m && m[2]) { explicitId = m[1]; title = cleanLabel(m[2]); }
      else if (m) { explicitId = m[1].replace(/^"|"$/g, ''); title = explicitId; }
      else { title = rest.replace(/^"|"$/g, ''); }
      const tmp = `#sg${tmpCounter++}`;
      stack.push({ tmp, explicitId, title, line: i, parent: sgTmp });
      pending.push({ line: { kind: 'sgStart', text, sg: tmp }, tmp: sgTmp });
      continue;
    }

    if (word === 'end' && trimmed === 'end' && stack.length) {
      const sg = stack.pop()!;
      const id = sg.explicitId && !/\s/.test(sg.explicitId) ? sg.explicitId : `subGraph${closeCounter}`;
      closeCounter++;
      tmpToId.set(sg.tmp, id);
      model.subgraphs.set(sg.tmp, { id: sg.tmp, title: sg.title, line: sg.line, endLine: i, parent: sg.parent });
      pending.push({ line: { kind: 'sgEnd', text, sg: sg.tmp }, tmp: sg.parent });
      continue;
    }

    if (word === 'style' || word === 'click') {
      const m = /^(\w+)\s+(\S+)(.*)$/.exec(trimmed);
      if (m) { push({ kind: 'ref', text, indent, keyword: word, ids: [m[2]], rest: m[3] }); continue; }
    }
    if (word === 'class') {
      const m = /^class\s+(\S+)(.*)$/.exec(trimmed);
      if (m) { push({ kind: 'ref', text, indent, keyword: 'class', ids: m[1].split(','), rest: m[2] }); continue; }
    }
    if (word === 'linkStyle') {
      const m = /^linkStyle\s+(\S+)(.*)$/.exec(trimmed);
      if (m) {
        const indices = m[1] === 'default' ? 'default' as const : m[1].split(',').map(Number);
        push({ kind: 'linkStyle', text, indent, indices, rest: m[2] });
        continue;
      }
    }
    if (word && ['classDef', 'direction', 'accTitle', 'accDescr', 'title'].includes(word)) {
      push({ kind: 'raw', text });
      continue;
    }

    const parts = splitStatements(trimmed);
    const stmts: Stmt[] = [];
    let ok = parts.length > 0;
    for (const p of parts) {
      const st = parseStatement(p, labels);
      if (!st) { ok = false; break; }
      stmts.push(st);
    }
    if (!ok) { push({ kind: 'raw', text }); continue; }

    for (const st of stmts) {
      for (const g of st.groups) for (const r of g) {
        if (!firstLine.has(r.id)) firstLine.set(r.id, i);
        if (r.hasShape && !defLine.has(r.id)) defLine.set(r.id, i);
        if (sgTmp && !membership.has(r.id)) membership.set(r.id, sgTmp);
      }
      for (let k = 0; k < st.links.length; k++) {
        for (const a of st.groups[k]) for (const b of st.groups[k + 1]) {
          const pair = `${a.id}->${b.id}`;
          const n = pairCount.get(pair) ?? 0;
          pairCount.set(pair, n + 1);
          model.edges.push({ key: `${pair}#${n}`, index: model.edges.length, from: a.id, to: b.id, label: st.links[k].label, line: i });
        }
      }
    }
    push({ kind: 'stmt', text, indent, stmts });
  }

  // Byt ut tillfälliga subgraf-nycklar mot Mermaids riktiga id:n.
  const resolve = (tmp?: string) => (tmp ? tmpToId.get(tmp) ?? tmp : undefined);
  const sgs = new Map<string, FlowSubgraph>();
  for (const sg of model.subgraphs.values()) {
    const id = resolve(sg.id)!;
    sgs.set(id, { ...sg, id, parent: resolve(sg.parent) });
  }
  model.subgraphs = sgs;
  model.lines = pending.map(({ line, tmp }) => {
    const sg = resolve(tmp);
    if (line.kind === 'sgStart' || line.kind === 'sgEnd') return { ...line, sg: resolve(line.sg)! };
    return { ...line, sg };
  });

  for (const [id, line] of firstLine) {
    model.nodes.set(id, { id, label: labels.get(id) ?? id, line: defLine.get(id) ?? line, subgraph: resolve(membership.get(id)) });
  }
  return model;
}

// ---------------------------------------------------------------- filter

export const nodeKey = (id: string) => `n:${id}`;
export const edgeKey = (key: string) => `e:${key}`;
export const subgraphKey = (id: string) => `s:${id}`;

export interface Visibility {
  isNodeHidden(id: string): boolean;
  isEdgeHidden(e: FlowEdge): boolean;
  isSubgraphHidden(id: string): boolean;
}

export function visibility(model: DiagramModel, hidden: ReadonlySet<string>): Visibility {
  const sgHidden = (id: string | undefined): boolean => {
    for (let cur = id; cur; cur = model.subgraphs.get(cur)?.parent) {
      if (hidden.has(subgraphKey(cur))) return true;
    }
    return false;
  };
  // En kant kan gå till en subgraf (t.ex. ett sammansatt tillstånd); den döljs med subgrafen.
  const nodeHidden = (id: string) =>
    hidden.has(nodeKey(id)) || sgHidden(model.nodes.get(id)?.subgraph) || (model.subgraphs.has(id) && sgHidden(id));
  return {
    isNodeHidden: nodeHidden,
    isEdgeHidden: e => hidden.has(edgeKey(e.key)) || nodeHidden(e.from) || nodeHidden(e.to),
    isSubgraphHidden: id => sgHidden(id),
  };
}

// ---------------------------------------------------------------- hopfällning

export const collapseKey = (id: string) => `c:${id}`;

export interface Collapse {
  /** Den yttersta hopfällda gruppen som ritar id:t (nod eller subgraf), om någon. */
  owner(id: string): string | undefined;
  /** Antal synliga noder i en grupp (utan [*]), för rutans etikett. */
  count(sgId: string): number;
  /** Kanter som ritas, med index till modellens kant och ändar efter omdragning. */
  kept: Map<number, { from: string; to: string; remapped: boolean }>;
}

/**
 * Hopfällda grupper ritas som en enda ruta. Kanter in i och ut ur gruppen dras om
 * till rutan, kanter helt inne i den försvinner, och omdragna kanter som blir
 * dubbletter av en redan ritad kant tas bort. Dold slår hopfälld.
 */
export function collapse(model: DiagramModel, hidden: ReadonlySet<string>): Collapse {
  const vis = visibility(model, hidden);
  const collapsed = (sg: string) => hidden.has(collapseKey(sg)) && !vis.isSubgraphHidden(sg);
  const outermost = (start: string | undefined) => {
    let found: string | undefined;
    for (let cur = start; cur; cur = model.subgraphs.get(cur)?.parent) if (collapsed(cur)) found = cur;
    return found;
  };
  const owner = (id: string) => outermost(model.subgraphs.has(id) ? id : model.nodes.get(id)?.subgraph);

  const kept: Collapse['kept'] = new Map();
  const seen = new Set<string>();
  for (const e of model.edges) {
    if (vis.isEdgeHidden(e)) continue;
    const from = owner(e.from) ?? e.from;
    const to = owner(e.to) ?? e.to;
    const remapped = from !== e.from || to !== e.to;
    const pair = `${from}->${to}`;
    if (remapped && (from === to || seen.has(pair))) continue;
    seen.add(pair);
    kept.set(e.index, { from, to, remapped });
  }

  const count = (sgId: string) => [...model.nodes.values()].filter(n => {
    if (n.pseudo || vis.isNodeHidden(n.id)) return false;
    for (let cur = n.subgraph; cur; cur = model.subgraphs.get(cur)?.parent) if (cur === sgId) return true;
    return false;
  }).length;

  return { owner, count, kept };
}

/** Rutans etikett: gruppens titel och hur många noder den döljer. Citattecken går inte att ha inuti. */
export const collapsedLabel = (title: string, n: number) => `${title.replace(/"/g, '#quot;')} (+${n})`;

/** Bygger diagramtext utan dolda element. Oförändrade rader lämnas exakt som de var. */
export function filterFlowchart(model: FlowModel, hidden: ReadonlySet<string>): string {
  if (!model.supported || hidden.size === 0) return model.lines.map(l => l.text).join('\n');
  const vis = visibility(model, hidden);
  const col = collapse(model, hidden);
  const out: string[] = [];
  const indexMap = new Map<number, number>();
  let edgeIdx = 0;
  let kept = 0;
  // linkStyle hänvisar till kantnummer, så numreringen räknas om efter filtreringen.
  for (const e of model.edges) if (col.kept.has(e.index)) indexMap.set(e.index, kept++);
  // Rader i en hopfälld grupp ersätts av gruppens ruta.
  const insideCollapsed = (sg: string | undefined) => sg !== undefined && col.owner(sg) !== undefined;
  const absorbed = (id: string) => { const o = col.owner(id); return o !== undefined && o !== id; };

  // Subgrafer där allt innehåll är dolt tas också bort, annars blir det tomma rutor.
  const hasVisible = (id: string): boolean =>
    [...model.nodes.values()].some(n => n.subgraph === id && !vis.isNodeHidden(n.id)) ||
    [...model.subgraphs.values()].some(s => s.parent === id && hasVisible(s.id));
  const hadContent = (id: string): boolean =>
    [...model.nodes.values()].some(n => n.subgraph === id) || [...model.subgraphs.values()].some(s => s.parent === id);
  const dropped = new Set([...model.subgraphs.keys()].filter(id => vis.isSubgraphHidden(id) || (hadContent(id) && !hasVisible(id))));

  // Noder som redan finns i utdata behöver inte nämnas igen utan form.
  const declared = new Set<string>();

  for (const line of model.lines) {
    switch (line.kind) {
      case 'sgStart':
      case 'sgEnd': {
        if (dropped.has(line.sg)) break;
        const owner = col.owner(line.sg);
        if (owner === undefined) out.push(line.text);
        else if (owner === line.sg && line.kind === 'sgStart') {
          const indent = line.text.slice(0, line.text.length - line.text.trimStart().length);
          const title = model.subgraphs.get(line.sg)!.title;
          out.push(`${indent}${line.sg}[["${collapsedLabel(title, col.count(line.sg))}"]]`);
          declared.add(line.sg);
        }
        break;
      }
      case 'raw':
        if (!line.sg || (!dropped.has(line.sg) && !insideCollapsed(line.sg))) out.push(line.text);
        break;
      case 'ref': {
        if (insideCollapsed(line.sg)) break;
        const ids = line.ids.filter(id => !vis.isNodeHidden(id) && !(model.subgraphs.has(id) && vis.isSubgraphHidden(id)) && !absorbed(id));
        if (ids.length === line.ids.length) out.push(line.text);
        else if (ids.length) out.push(`${line.indent}${line.keyword} ${ids.join(',')}${line.rest}`);
        break;
      }
      case 'linkStyle': {
        if (insideCollapsed(line.sg)) break;
        if (line.indices === 'default') { out.push(line.text); break; }
        const idx = line.indices.filter(n => indexMap.has(n)).map(n => indexMap.get(n)!);
        if (idx.length) out.push(`${line.indent}linkStyle ${idx.join(',')}${line.rest}`);
        break;
      }
      case 'stmt': {
        const pieces: string[] = [];
        let changed = false;
        for (const st of line.stmts) {
          const emitted = new Set<string>();
          for (let k = 0; k < st.links.length; k++) {
            for (const a of st.groups[k]) for (const b of st.groups[k + 1]) {
              const e = model.edges[edgeIdx++];
              const k2 = col.kept.get(e.index);
              if (!k2) { changed = true; continue; }
              if (k2.remapped) changed = true;
              const aText = k2.from === a.id ? a.text : k2.from;
              const bText = k2.to === b.id ? b.text : k2.to;
              pieces.push(`${aText} ${st.links[k].text} ${bText}`);
              emitted.add(k2.from);
              emitted.add(k2.to);
            }
          }
          // Synliga noder som bara hörde till dolda kanter behåller sin deklaration (form/etikett).
          const seen = new Set<string>();
          for (const g of st.groups) for (const r of g) {
            if (emitted.has(r.id) || seen.has(r.id)) continue;
            seen.add(r.id);
            if (vis.isNodeHidden(r.id) || absorbed(r.id)) { changed = true; continue; }
            const best = st.groups.flat().find(x => x.id === r.id && x.hasShape) ?? r;
            if (st.links.length) changed = true;
            if (!best.hasShape && declared.has(r.id)) continue;
            pieces.push(best.text);
            emitted.add(r.id);
          }
          for (const id of emitted) declared.add(id);
        }
        if (!changed) out.push(line.text);
        else if (pieces.length) out.push(line.indent + pieces.join('\n' + line.indent));
        break;
      }
    }
  }
  return out.join('\n');
}

/** Alla noder inom `depth` steg från `id`, oavsett kantriktning. */
export function neighborhood(model: DiagramModel, id: string, depth: number): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of model.edges) {
    (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
    (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e.from);
  }
  const seen = new Set([id]);
  let frontier = [id];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const n of frontier) for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); next.push(m); }
    frontier = next;
  }
  return seen;
}
