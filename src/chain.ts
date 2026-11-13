// Focus: noderna man når från en nod eller grupp genom pilarna, ut, in eller in och ut.

import { DiagramModel, groupMembers, nodeKey, subgraphKey } from './parser';

export { arrowDirection } from './arrow';

/**
 * follow: det som kommer efter (ut); against: det som leder hit (in); both: in och ut, där varje gren
 * fortsätter i sin egen riktning. Det som bara hänger ihop via en sidogren (B --> a, B --> c) räknas inte.
 */
export type ChainDirection = 'follow' | 'against' | 'both';

/**
 * Det som ska synas: starten (noden, eller gruppen med allt i den) och allt som nås inom `steps`
 * steg (Infinity för hela kedjan). En pil utan riktning går att följa åt båda hållen.
 */
export function chain(model: DiagramModel, start: { kind: 'node' | 'subgraph'; id: string }, direction: ChainDirection, steps: number): Set<string> {
  if (direction === 'both') {
    return new Set([...chain(model, start, 'follow', steps), ...chain(model, start, 'against', steps)]);
  }
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); };
  for (const e of model.edges) {
    const dir = e.dir ?? 'forward';
    // Pilen går att följa från from till to (forward), från to till from (backward), eller båda.
    const [a, b] = direction === 'follow' ? [e.from, e.to] : [e.to, e.from];
    if (dir !== 'backward') add(a, b);
    if (dir !== 'forward') add(b, a);
  }
  // En pil till eller från en grupp (sammansatt state, subgraf) gäller också allt i den, på alla nivåer.
  const groupsAround = (id: string): string[] => {
    const out: string[] = [];
    let cur = model.subgraphs.has(id) ? model.subgraphs.get(id)!.parent : model.nodes.get(id)?.subgraph;
    for (; cur; cur = model.subgraphs.get(cur)?.parent) out.push(cur);
    return out;
  };
  const seen = start.kind === 'subgraph' ? groupMembers(model, start.id) : new Set([start.id]);
  let frontier = [...seen];
  for (let d = 0; d < steps && frontier.length; d++) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const from of [n, ...groupsAround(n)]) {
        for (const m of adj.get(from) ?? []) if (!seen.has(m)) { seen.add(m); next.push(m); }
      }
    }
    frontier = next;
  }
  return seen;
}

/** Valet i Show Chain: riktning och antal steg (Infinity för hela kedjan). */
export interface ChainChoice { direction: ChainDirection; steps: number }

/** Diagramtypen som valet sparas för; varianter som flowchart och graph delar val. */
export function chainFamily(diagramType: string): string {
  if (/^stateDiagram/.test(diagramType)) return 'state';
  if (/^classDiagram/.test(diagramType)) return 'class';
  if (diagramType === 'sequenceDiagram') return 'sequence';
  return 'flowchart';
}

/**
 * Det generella valet, som Focus-knappen alltid gör: in och ut, hela kedjan, i alla diagramtyper.
 * Specialfall (bara ut, bara in, färre steg) väljs med Focus… i högerklicksmenyn.
 */
export function defaultChain(_diagramType: string): ChainChoice {
  return { direction: 'both', steps: Infinity };
}

/**
 * Det fokus döljer: allt utanför kedjan. Även grupper som varken nås av kedjan eller har något i den,
 * annars står en pil mellan två sådana grupper (G2 --> G3) kvar och grupperna ritas som tomma rutor.
 */
export function focusHidden(model: DiagramModel, keep: ReadonlySet<string>): string[] {
  const keptGroups = new Set<string>();
  const markUp = (sg: string | undefined) => {
    for (let cur = sg; cur && !keptGroups.has(cur); cur = model.subgraphs.get(cur)?.parent) keptGroups.add(cur);
  };
  for (const id of keep) {
    if (model.subgraphs.has(id)) markUp(id);
    else { const n = model.nodes.get(id); if (n && !n.pseudo) markUp(n.subgraph); }
  }
  return [
    ...[...model.nodes.keys()].filter(id => !keep.has(id)).map(nodeKey),
    ...[...model.subgraphs.keys()].filter(id => !keptGroups.has(id)).map(subgraphKey),
  ];
}
