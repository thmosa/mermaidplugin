// Arbetsträdets struktur: vilka rader som finns och hur de hänger ihop. Rena funktioner
// utan vscode, så att de kan testas direkt. extension.ts gör om dem till TreeItems.

import { DiagramModel } from './parser';

export type Item =
  | { kind: 'subgraph'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'edgeGroup' }
  | { kind: 'edge'; key: string }
  | { kind: 'info'; text: string };

/** Barnen till `parent`, eller översta nivån. */
export function children(model: DiagramModel, parent?: Item): Item[] {
  if (!model.supported) {
    return parent ? [] : [{ kind: 'info', text: `Diagram type "${model.diagramType}" is not supported yet (only flowchart and state diagram)` }];
  }
  if (!parent || parent.kind === 'subgraph') {
    const sgId = parent?.kind === 'subgraph' ? parent.id : undefined;
    const items: Item[] = [...model.subgraphs.values()]
      .filter(sg => sg.parent === sgId)
      .sort((a, b) => a.line - b.line)
      .map(sg => ({ kind: 'subgraph', id: sg.id }));
    for (const n of model.nodes.values()) if (n.subgraph === sgId) items.push({ kind: 'node', id: n.id });
    if (!parent && model.edges.length) items.push({ kind: 'edgeGroup' });
    return items;
  }
  if (parent.kind === 'edgeGroup') return model.edges.map(e => ({ kind: 'edge', key: e.key }));
  return [];
}

export function parentOf(model: DiagramModel, item: Item): Item | undefined {
  if (item.kind === 'edge') return { kind: 'edgeGroup' };
  const sg = item.kind === 'node' ? model.nodes.get(item.id)?.subgraph
    : item.kind === 'subgraph' ? model.subgraphs.get(item.id)?.parent
      : undefined;
  return sg ? { kind: 'subgraph', id: sg } : undefined;
}

/** Grupper börjar hopfällda så att stora diagram går att överblicka. */
export function initialState(item: Item): 'collapsed' | 'expanded' | 'none' {
  return item.kind === 'subgraph' || item.kind === 'edgeGroup' ? 'collapsed' : 'none';
}
