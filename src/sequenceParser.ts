// Lättviktig parser för Mermaid sequenceDiagram. Ger samma modell som de andra
// parsrarna: deltagare blir noder, meddelanden kanter och box grupper. Filtreringen
// skriver om texten rad för rad och håller ordning på det som annars kraschar Mermaid:
// aktiveringar som inte går jämnt upp, create utan sitt meddelande och tomma block.

import { DiagramModel, FlowEdge, FlowNode, visibility, subgraphKey, collapseKey } from './parser';

type Line =
  | { kind: 'raw'; text: string }
  | { kind: 'autonumber'; text: string; start?: number; step?: number; off: boolean }
  | { kind: 'decl'; text: string; id: string }
  | { kind: 'create'; text: string; indent: string; id: string; edge?: number }
  | { kind: 'destroy'; text: string; id: string; edge?: number }
  | { kind: 'ref'; text: string; id: string }
  | { kind: 'activate'; text: string; id: string; on: boolean }
  | { kind: 'msg'; text: string; indent: string; plus: boolean; minus: boolean; num?: number; step: number }
  | { kind: 'note'; text: string; indent: string; word: string; pos: string; ids: string[]; rest: string }
  | { kind: 'boxStart'; text: string }
  | { kind: 'blockStart'; text: string; id: string }
  | { kind: 'mid'; text: string; id?: string }
  | { kind: 'end'; text: string };

/** loop, alt, opt … och deras grenar (else, and, option). En gren har id <block>:<n>. */
export interface SeqBlock {
  id: string;
  kind: string;
  title: string;
  line: number;
  endLine: number;
  parent: string | undefined;
  section: boolean;
}

export interface SequenceModel extends DiagramModel {
  lines: Line[];
  blocks: Map<string, SeqBlock>;
  /** Närmaste block eller gren för varje meddelande, i samma ordning som edges. */
  edgeParent: (string | undefined)[];
}

const ARROW = String.raw`(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))`;
const MSG_RE = new RegExp(`^(.+?)\\s*${ARROW}\\s*([+-]?)\\s*(.+?)\\s*:(.*)$`);
const DECL_RE = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/;
const NOTE_RE = /^(note)\s+(left of|right of|over)\s+([^:]+?)\s*:(.*)$/i;

// Färgnamn som Mermaid tar bort från början av en box-titel (CSS-färger).
const CSS_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
  'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue ' +
  'darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid ' +
  'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink ' +
  'deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold ' +
  'goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush ' +
  'lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey ' +
  'lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime ' +
  'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
  'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin ' +
  'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise ' +
  'palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
  'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow ' +
  'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent').split(' '));

function boxTitle(rest: string): string {
  const s = rest.trim();
  const fn = /^(?:rgba?|hsla?)\([^)]*\)\s*/i.exec(s);
  if (fn) return s.slice(fn[0].length).trim();
  const word = /^(\S+)\s*(.*)$/.exec(s);
  if (word && (CSS_COLORS.has(word[1].toLowerCase()) || /^#[0-9a-f]{3,8}$/i.test(word[1]))) return word[2].trim();
  return s;
}

const indentOf = (text: string) => text.slice(0, text.length - text.trimStart().length);

export function parseSequence(text: string): SequenceModel {
  const src = text.split(/\r?\n/);
  const model: SequenceModel = {
    supported: false, diagramType: '', nodes: new Map(), edges: [], subgraphs: new Map(), lines: [], blocks: new Map(), edgeParent: [],
  };
  const firstLine = new Map<string, number>();
  const defLine = new Map<string, number>();
  const labels = new Map<string, string>();
  const membership = new Map<string, string | undefined>();
  const pairCount = new Map<string, number>();
  // Öppna box och block; end stänger det senaste av dem. container är blockets aktuella gren.
  const stack: ({ kind: 'box' } | { kind: 'block'; id: string; container: string; sections: number })[] = [];
  const container = () => {
    for (let k = stack.length - 1; k >= 0; k--) { const f = stack[k]; if (f.kind === 'block') return f.container; }
    return undefined;
  };
  let box: string | undefined;
  let boxCount = 0;
  let blockCount = 0;
  let numbering: { next: number; step: number } | undefined;
  // create och destroy hör ihop med nästa meddelande; Mermaid kräver att det finns kvar.
  let pending: { edge?: number } | undefined;

  const mention = (id: string, line: number) => {
    if (!firstLine.has(id)) firstLine.set(id, line);
    if (!membership.has(id)) membership.set(id, box);
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
    if (t === '' || t.startsWith('%%')) { model.lines.push({ kind: 'raw', text }); continue; }

    if (!headerSeen) {
      headerSeen = true;
      model.diagramType = /^(\w[\w-]*)/.exec(t)?.[1] ?? '';
      model.supported = model.diagramType === 'sequenceDiagram';
      model.lines.push({ kind: 'raw', text });
      if (!model.supported) {
        for (let k = i + 1; k < src.length; k++) model.lines.push({ kind: 'raw', text: src[k] });
        break;
      }
      continue;
    }

    const auto = /^autonumber\b\s*(.*)$/.exec(t);
    if (auto) {
      const args = auto[1].trim().split(/\s+/).filter(Boolean);
      if (args[0] === 'off') { numbering = undefined; model.lines.push({ kind: 'autonumber', text, off: true }); continue; }
      const start = args[0] ? Number(args[0]) : 1;
      const step = args[1] ? Number(args[1]) : 1;
      numbering = { next: start, step };
      model.lines.push({ kind: 'autonumber', text, start, step, off: false });
      continue;
    }

    const create = /^create\s+(.*)$/.exec(t);
    const decl = DECL_RE.exec(create ? create[1] : t);
    if (decl) {
      const id = decl[2].replace(/@\{.*\}$/, '').trim();
      if (decl[3]) labels.set(id, decl[3].trim());
      if (!defLine.has(id)) defLine.set(id, i);
      mention(id, i);
      if (create) {
        const line: Line = { kind: 'create', text, indent: indentOf(text), id };
        pending = line;
        model.lines.push(line);
      } else {
        model.lines.push({ kind: 'decl', text, id });
      }
      continue;
    }

    const destroy = /^destroy\s+(.+)$/.exec(t);
    if (destroy) {
      const line: Line = { kind: 'destroy', text, id: destroy[1].trim() };
      pending = line;
      model.lines.push(line);
      continue;
    }

    const ref = /^(links?)\s+([^:]+?)\s*(?::.*)?$/.exec(t);
    if (ref) { model.lines.push({ kind: 'ref', text, id: ref[2].trim() }); continue; }

    const act = /^(activate|deactivate)\s+(.+)$/.exec(t);
    if (act) { model.lines.push({ kind: 'activate', text, id: act[2].trim(), on: act[1] === 'activate' }); continue; }

    const note = NOTE_RE.exec(t);
    if (note) {
      const ids = note[3].split(',').map(s => s.trim());
      for (const id of ids) mention(id, i);
      model.lines.push({ kind: 'note', text, indent: indentOf(text), word: note[1], pos: note[2], ids, rest: note[4] });
      continue;
    }

    const boxStart = /^box\b(.*)$/.exec(t);
    if (boxStart) {
      box = `box${boxCount++}`;
      model.subgraphs.set(box, { id: box, title: boxTitle(boxStart[1]) || box, line: i, endLine: i, parent: undefined });
      stack.push({ kind: 'box' });
      model.lines.push({ kind: 'boxStart', text });
      continue;
    }
    const blockStart = /^(loop|alt|opt|par_over|par|critical|break|rect)\b\s*(.*)$/.exec(t);
    if (blockStart) {
      const id = `block${blockCount++}`;
      model.blocks.set(id, { id, kind: blockStart[1], title: blockStart[2].trim(), line: i, endLine: i, parent: container(), section: false });
      stack.push({ kind: 'block', id, container: id, sections: 0 });
      model.lines.push({ kind: 'blockStart', text, id });
      continue;
    }
    const mid = /^(else|and|option)\b\s*(.*)$/.exec(t);
    if (mid) {
      const f = stack[stack.length - 1];
      let id: string | undefined;
      if (f?.kind === 'block') {
        // Första else: huvudgrenen blir gren 0, så att den kan fällas ihop för sig.
        if (f.sections === 0) {
          const b = model.blocks.get(f.id)!;
          const first = `${f.id}:0`;
          model.blocks.set(first, { id: first, kind: b.kind, title: b.title, line: b.line, endLine: i, parent: f.id, section: true });
          model.edgeParent = model.edgeParent.map(p => p === f.id ? first : p);
          for (const nested of model.blocks.values()) if (!nested.section && nested.parent === f.id) nested.parent = first;
        }
        // Föregående gren slutar där den här börjar.
        const prev = model.blocks.get(f.container);
        if (prev?.section) prev.endLine = i;
        id = `${f.id}:${++f.sections}`;
        model.blocks.set(id, { id, kind: mid[1], title: mid[2].trim(), line: i, endLine: i, parent: f.id, section: true });
        f.container = id;
      }
      model.lines.push({ kind: 'mid', text, id });
      continue;
    }
    if (t === 'end') {
      const f = stack.pop();
      if (f?.kind === 'box' && box) { model.subgraphs.get(box)!.endLine = i; box = undefined; }
      // Blocket och dess sista gren slutar på end.
      if (f?.kind === 'block') {
        model.blocks.get(f.id)!.endLine = i;
        model.blocks.get(f.container)!.endLine = i;
      }
      model.lines.push({ kind: 'end', text });
      continue;
    }

    const msg = MSG_RE.exec(t);
    if (msg) {
      const from = msg[1].trim();
      const to = msg[4].trim();
      mention(from, i);
      mention(to, i);
      const pair = `${from}->${to}`;
      const n = pairCount.get(pair) ?? 0;
      pairCount.set(pair, n + 1);
      if (pending) { pending.edge = model.edges.length; pending = undefined; }
      model.edges.push({ key: `${pair}#${n}`, index: model.edges.length, from, to, label: msg[5].trim(), line: i });
      model.edgeParent.push(container());
      const num = numbering?.next;
      if (numbering) numbering.next += numbering.step;
      model.lines.push({ kind: 'msg', text, indent: indentOf(text), plus: msg[3] === '+', minus: msg[3] === '-', num, step: numbering?.step ?? 1 });
      continue;
    }

    model.lines.push({ kind: 'raw', text });
  }

  // Radordning, med blocket före sin gren 0 (de börjar på samma rad).
  model.blocks = new Map([...model.blocks.entries()].sort(([, a], [, b]) => a.line - b.line || Number(a.section) - Number(b.section)));

  for (const [id, line] of firstLine) {
    const node: FlowNode = { id, label: labels.get(id) ?? id, line: defLine.get(id) ?? line, subgraph: membership.get(id) };
    model.nodes.set(id, node);
  }
  return model;
}

/** Bygger diagramtext utan dolda element. Oförändrade rader lämnas exakt som de var. */
export function filterSequence(model: SequenceModel, hidden: ReadonlySet<string>): string {
  return filterSequenceDetailed(model, hidden).text;
}

/**
 * Det yttersta dolda eller hopfällda blocket, eller hopfällda grenen, som `id` ligger i eller är.
 * Det bestämmer över allt inuti; dolt slår hopfällt i filtret. Grenar kan bara fällas ihop.
 */
export function blockSuppressor(model: SequenceModel, hidden: ReadonlySet<string>, id: string | undefined): SeqBlock | undefined {
  const chain: SeqBlock[] = [];
  for (let b = id ? model.blocks.get(id) : undefined; b; b = b.parent ? model.blocks.get(b.parent) : undefined) chain.unshift(b);
  return chain.find(b => hidden.has(collapseKey(b.id)) || (!b.section && hidden.has(subgraphKey(b.id))));
}

const collapsedText =(n: number) => n === 0 ? 'collapsed' : n === 1 ? '1 message hidden' : `${n} messages hidden`;

export interface SequenceRender {
  text: string;
  blocks: string[];
  rects: string[];
  /** Grenarna som ritas för varje block, i samma ordning som dess sectionTitle i SVG:n. */
  sections: Record<string, string[]>;
}

/**
 * Som filterSequence, men talar också om vilka block Mermaid ritar, i SVG:ns ordning:
 * block (loop, alt …) i den ordning de stängs, rect i omvänd ordning (de läggs först i SVG:n).
 */
export function filterSequenceDetailed(model: SequenceModel, hidden: ReadonlySet<string>): SequenceRender {
  const vis = visibility(model, hidden);
  const gone = (id: string) => vis.isNodeHidden(id);

  const suppressor = (id: string | undefined) => blockSuppressor(model, hidden, id);
  const edgeHidden = (e: FlowEdge) => vis.isEdgeHidden(e) || suppressor(model.edgeParent[e.index]) !== undefined;

  // Anteckningen i ett hopfällt block sträcker sig mellan de synliga deltagare blocket rör.
  const order = [...model.nodes.keys()];
  const collapsedNote = (b: SeqBlock, indent: string): { text: string; ids: string[] } | undefined => {
    const inside = (line: number) => b.line < line && line < b.endLine;
    const edges = model.edges.filter(e => inside(e.line));
    const ids = new Set(edges.flatMap(e => [e.from, e.to]));
    model.lines.forEach((l, k) => { if (l.kind === 'note' && inside(k)) for (const id of l.ids) ids.add(id); });
    const span = order.filter(id => ids.has(id) && !gone(id));
    if (!span.length) return undefined;
    const over = span.length > 1 ? `${span[0]},${span[span.length - 1]}` : span[0];
    return { text: `${indent}  Note over ${over}: ${collapsedText(edges.length)}`, ids: span };
  };
  // Blocken och grenarna som bestämmer över sitt innehåll; hopfällda får en anteckning.
  const heads = new Map<string, ReturnType<typeof collapsedNote>>();
  const ranges: SeqBlock[] = [];
  for (const l of model.lines) {
    if ((l.kind !== 'blockStart' && l.kind !== 'mid') || !l.id) continue;
    // Ett block börjar också sin huvudgren (gren 0), om blocket har fler grenar.
    for (const id of l.kind === 'blockStart' ? [l.id, `${l.id}:0`] : [l.id]) {
      const b = model.blocks.get(id);
      if (!b || suppressor(id)?.id !== id) continue;
      ranges.push(b);
      if (!hidden.has(subgraphKey(id)) || b.section) heads.set(id, collapsedNote(b, indentOf(l.text)));
    }
  }

  // Deltagare som syns på annat håll behöver ingen extra deklaration när ett meddelande försvinner.
  const shown = new Set<string>();
  for (const [k, l] of model.lines.entries()) {
    if (ranges.some(b => b.line < k && k < b.endLine)) continue;
    if ((l.kind === 'decl' || l.kind === 'create') && !gone(l.id)) shown.add(l.id);
    if (l.kind === 'note') for (const id of l.ids) if (!gone(id)) shown.add(id);
  }
  for (const e of model.edges) if (!edgeHidden(e)) { shown.add(e.from); shown.add(e.to); }
  for (const note of heads.values()) for (const id of note?.ids ?? []) shown.add(id);

  // Box och block buffras; ett block utan innehåll kvar tas bort helt.
  interface Frame { header?: string; id?: string; buf: string[]; content: boolean; section?: boolean }
  const frames: Frame[] = [{ buf: [], content: false }];
  const drawnBlocks: string[] = [];
  const drawnRects: string[] = [];
  const drawnSections: Record<string, string[]> = {};
  // > 0 inne i ett dolt eller hopfällt block: allt utom numrering hoppas över.
  let suppressed = 0;
  const top = () => frames[frames.length - 1];
  const content = (text: string) => { top().buf.push(text); top().content = true; };
  const plain = (text: string) => top().buf.push(text);
  const rootIndent = indentOf(model.lines.find((l, k) => k > 0 && l.text.trim() !== '' && l.kind !== 'raw')?.text ?? '  ') || '  ';

  const active = new Map<string, number>();
  const level = (id: string) => active.get(id) ?? 0;
  let outNext: number | undefined;
  let edgeIdx = 0;

  let suppressedFrame = false;
  let suppressedSection = false;

  // En gren buffras också; en tom gren tas bort eftersom en tom sista gren hamnar utanför ramen.
  const closeSection = () => {
    if (!top().section) return;
    const f = frames.pop()!;
    if (!f.content) return;
    top().buf.push(f.header!, ...f.buf);
    top().content = true;
    const block = model.blocks.get(f.id!)!.parent!;
    (drawnSections[block] ??= []).push(f.id!);
  };

  // Ett dolt meddelande; synliga deltagare som bara fanns i det behåller sin livslinje.
  const hideMessage = (e: FlowEdge) => {
    for (const id of [e.from, e.to]) {
      if (gone(id) || shown.has(id)) continue;
      frames[0].buf.push(`${rootIndent}participant ${id}`);
      shown.add(id);
    }
  };

  for (const line of model.lines) {
    if (suppressed > 0) {
      if (line.kind === 'blockStart') suppressed++;
      // Slutet på ett hopfällt block, eller nästa gren efter en hopfälld gren, hanteras som vanligt.
      let resume = false;
      if (line.kind === 'end') resume = --suppressed === 0 && suppressedFrame;
      else if (line.kind === 'mid' && suppressed === 1 && suppressedSection) { suppressed = 0; resume = true; }
      if (!resume) {
        if (line.kind === 'autonumber') { plain(line.text); outNext = line.off ? undefined : line.start; }
        if (line.kind === 'msg') hideMessage(model.edges[edgeIdx++]);
        continue;
      }
    }
    switch (line.kind) {
      case 'raw':
        plain(line.text);
        break;
      case 'mid': {
        if (!line.id) { plain(line.text); break; }
        closeSection();
        frames.push({ header: line.text, id: line.id, buf: [], content: false, section: true });
        if (suppressor(line.id)?.id !== line.id) break;
        // Hopfälld gren: rubriken behålls med en anteckning i stället för innehållet.
        const note = heads.get(line.id);
        if (note) content(note.text);
        suppressed = 1;
        suppressedFrame = true;
        suppressedSection = true;
        break;
      }
      case 'autonumber':
        plain(line.text);
        outNext = line.off ? undefined : line.start;
        break;
      case 'decl':
        if (!gone(line.id)) content(line.text);
        break;
      case 'create': {
        if (gone(line.id)) break;
        const edge = line.edge === undefined ? undefined : model.edges[line.edge];
        // create kräver sitt skapande meddelande direkt efter; utan det blir det en vanlig deklaration.
        content(edge && !edgeHidden(edge) ? line.text : line.text.replace(/^(\s*)create\s+/, '$1'));
        break;
      }
      case 'destroy': {
        // Utan sitt avslutande meddelande kraschar Mermaid; sist i diagrammet behövs inget.
        const edge = line.edge === undefined ? undefined : model.edges[line.edge];
        if (!gone(line.id) && (!edge || !edgeHidden(edge))) content(line.text);
        break;
      }
      case 'ref':
        if (!gone(line.id)) content(line.text);
        break;
      case 'activate':
        if (gone(line.id)) break;
        if (line.on) active.set(line.id, level(line.id) + 1);
        else if (level(line.id) === 0) break;
        else active.set(line.id, level(line.id) - 1);
        content(line.text);
        break;
      case 'note': {
        const ids = line.ids.filter(id => !gone(id));
        if (!ids.length) break;
        content(ids.length === line.ids.length ? line.text : `${line.indent}${line.word} ${line.pos} ${ids.join(',')}:${line.rest}`);
        break;
      }
      case 'boxStart':
        frames.push({ header: line.text, buf: [], content: false });
        break;
      case 'blockStart': {
        if (suppressor(line.id)?.id !== line.id) {
          frames.push({ header: line.text, id: line.id, buf: [], content: false });
          // Hopfälld huvudgren: anteckningen direkt i blocket, fram till första else.
          const first = `${line.id}:0`;
          if (suppressor(first)?.id === first) {
            const note = heads.get(first);
            if (note) content(note.text);
            suppressed = 1;
            suppressedFrame = true;
            suppressedSection = true;
          }
          break;
        }
        // Dolt block, eller hopfällt: ramen behålls med en anteckning i stället för innehållet.
        const note = heads.get(line.id);
        suppressed = 1;
        suppressedFrame = note !== undefined;
        suppressedSection = false;
        if (note) {
          frames.push({ header: line.text, id: line.id, buf: [], content: false });
          content(note.text);
        }
        break;
      }
      case 'end': {
        closeSection();
        const f = frames.length > 1 ? frames.pop()! : undefined;
        if (!f?.content) break;
        top().buf.push(f.header!, ...f.buf, line.text);
        top().content = true;
        if (f.id !== undefined) model.blocks.get(f.id)!.kind === 'rect' ? drawnRects.unshift(f.id) : drawnBlocks.push(f.id);
        break;
      }
      case 'msg': {
        const e = model.edges[edgeIdx++];
        if (edgeHidden(e)) { hideMessage(e); break; }
        let text = line.text;
        // - avaktiverar avsändaren; utan aktivering kvar skulle Mermaid krascha.
        if (line.minus) {
          if (level(e.from) === 0) text = text.replace(new RegExp(`${ARROW}\s*-`), '$1');
          else active.set(e.from, level(e.from) - 1);
        }
        if (line.plus) active.set(e.to, level(e.to) + 1);
        // Behåll originalnumret när meddelanden före har dolts.
        if (line.num !== undefined && outNext !== undefined && line.num !== outNext) {
          plain(`${line.indent}autonumber ${line.num}${line.step !== 1 ? ` ${line.step}` : ''}`);
        }
        if (line.num !== undefined) outNext = line.num + line.step;
        content(text);
        break;
      }
    }
  }
  // Utan något dolt ska texten vara exakt som den var.
  const text = model.supported && hidden.size > 0 ? frames[0].buf.join('\n') : model.lines.map(l => l.text).join('\n');
  return { text, blocks: drawnBlocks, rects: drawnRects, sections: drawnSections };
}
