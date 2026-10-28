// Kontroller av diagramtexten som visas som fel i editorn. Rena funktioner utan vscode,
// så att de kan testas direkt.

import { DiagramModel } from './parser';

export interface CaseConflict {
  /** 0-baserad rad och kolumner [start, end) för id:t i texten. */
  line: number;
  start: number;
  end: number;
  id: string;
  /** Andra id:n som stavas likadant men med andra stora/små bokstäver. */
  similar: string[];
  message: string;
}

const ID_CHAR = String.raw`[\p{L}\p{N}_$]`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Byter ut text i citat, kantetiketter och nodformer mot mellanslag, så att kolumnerna behålls. */
function mask(line: string, isState: boolean): string {
  const blank = (m: string) => ' '.repeat(m.length);
  let out = line.replace(/"[^"]*"/g, blank).replace(/\|[^|]*\|/g, blank);
  if (isState) {
    out = out.replace(/(?<!:):(?!:).*$/, blank);
  } else {
    // Nodformer: A[text], A(text), A{text}, A>text] … innehållet är etikett, inte id.
    out = out.replace(/(?<=[\p{L}\p{N}_$])[\[({>][^\])}]*[\])}]+/gu, blank);
  }
  return out;
}

/**
 * Hittar id:n som bara skiljer sig i stora och små bokstäver (Mermaid skiljer på dem,
 * så "Still" och "still" blir två olika tillstånd). Varje användning av dem markeras.
 */
export function caseConflicts(text: string, model: DiagramModel): CaseConflict[] {
  if (!model.supported) return [];
  const src = text.split(/\r?\n/);
  const isState = /^stateDiagram/.test(model.diagramType);

  // Var varje id används: definitionsraden och raderna för kanter som rör det.
  const uses = new Map<string, Set<number>>();
  const use = (id: string, line: number) => (uses.get(id) ?? uses.set(id, new Set()).get(id)!).add(line);
  for (const n of model.nodes.values()) if (!n.pseudo) use(n.id, n.line);
  for (const sg of model.subgraphs.values()) use(sg.id, sg.line);
  for (const e of model.edges) {
    if (uses.has(e.from)) use(e.from, e.line);
    if (uses.has(e.to)) use(e.to, e.line);
  }

  const groups = new Map<string, string[]>();
  for (const id of uses.keys()) {
    const k = id.toLowerCase();
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(id);
  }

  const out: CaseConflict[] = [];
  const seen = new Set<string>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const similar = ids.filter(x => x !== id);
      const message = `"${id}" differs only in letter case from ${similar.map(s => `"${s}"`).join(', ')}. Mermaid treats them as different.`;
      const re = new RegExp(`(?<!${ID_CHAR}|${ID_CHAR}[.-])${escape(id)}(?!${ID_CHAR}|[.-]${ID_CHAR})`, 'gu');
      for (const line of uses.get(id)!) {
        const masked = mask(src[line] ?? '', isState);
        for (const m of masked.matchAll(re)) {
          const key = `${line}:${m.index}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ line, start: m.index!, end: m.index! + id.length, id, similar, message });
        }
      }
    }
  }
  return out.sort((a, b) => a.line - b.line || a.start - b.start);
}
