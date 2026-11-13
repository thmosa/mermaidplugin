// Samma state i två sammansatta states. I Mermaid är state-id:n globala: det blir en enda state, som
// ritas i den sista sammansatta staten som nämner den och får alla beskrivningar. Det ser ut som två
// states i koden men inte i bilden. En pil på översta nivån till en state i en grupp är däremot normal.
// Rena funktioner utan vscode, så att de kan testas direkt.

import { DiagramModel } from './parser';
import { StateModel } from './stateParser';
import { IdRange, occurrences } from './rename';

export interface SharedState {
  id: string;
  /** Den sammansatta staten varningen gäller; en varning per grupp som använder id:t. */
  group: string;
  /** Den sammansatta staten där Mermaid ritar det (kan vara `group`). */
  drawnIn: string;
  /** Varje användning av id:t i `group`, för varningen och för att ge det ett eget namn där. */
  ranges: IdRange[];
  /** Första användningen i var och en av de andra grupperna, för en länk i varningen. */
  related: (IdRange & { group: string })[];
  message: string;
}

const isState = (model: DiagramModel): model is StateModel => /^stateDiagram/.test(model.diagramType);

export function sharedStates(text: string, model: DiagramModel): SharedState[] {
  if (!isState(model) || !model.supported) return [];
  // Varje rad i texten har en rad i modellen, med den sammansatta state den ligger i.
  const scope = (line: number) => model.lines[line]?.sg;
  const name = (sg: string) => {
    const title = model.subgraphs.get(sg)?.title;
    return title && title !== sg ? `"${title}" (${sg})` : sg;
  };
  const out: SharedState[] = [];
  for (const node of model.nodes.values()) {
    if (node.pseudo || model.subgraphs.has(node.id)) continue;
    const drawnIn = node.subgraph;
    if (drawnIn === undefined) continue;
    const byGroup = new Map<string, IdRange[]>();
    for (const r of occurrences(text, model, node.id)) {
      const sg = scope(r.line);
      if (sg === undefined) continue;
      (byGroup.get(sg) ?? byGroup.set(sg, []).get(sg)!).push(r);
    }
    if (byGroup.size < 2) continue;
    const list = (groups: string[]) => groups.length === 1 ? groups[0] : `${groups.slice(0, -1).join(', ')} and ${groups[groups.length - 1]}`;
    for (const [group, ranges] of byGroup) {
      const others = [...byGroup.keys()].filter(g => g !== group);
      out.push({
        id: node.id, group, drawnIn, ranges,
        related: others.map(g => ({ ...byGroup.get(g)![0], group: g })),
        message: group === drawnIn
          ? `"${node.id}" is also used in ${list(others.map(name))}. Mermaid draws it as one state, here, so it is missing there.`
          : `"${node.id}" is also used in ${name(drawnIn)}. Mermaid draws it as one state there, so it is not shown here.`,
      });
    }
  }
  return out.sort((a, b) => a.ranges[0].line - b.ranges[0].line);
}

const STATE_ID = /^[\p{L}\p{N}_$.]+(?:-[\p{L}\p{N}_$.]+)*$/u;
const RESERVED = new Set(['state', 'note', 'end', 'as', 'direction', 'class', 'classDef', 'style', 'click']);

/** Vad som är fel med ett nytt namn för staten i gruppen, eller undefined om det går bra. */
export function ownNameProblem(model: DiagramModel, name: string): string | undefined {
  if (!STATE_ID.test(name) || RESERVED.has(name)) return `"${name}" is not a valid state name.`;
  if (model.nodes.has(name) || model.subgraphs.has(name)) return `"${name}" is already used in this diagram.`;
  return undefined;
}

/** Ett ledigt namn för staten i gruppen: id_grupp, med en siffra efter om det redan finns. */
export function ownNameSuggestion(model: DiagramModel, issue: SharedState): string {
  const base = `${issue.id}_${issue.group}`;
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}${n}`;
    if (!ownNameProblem(model, name)) return name;
  }
}
