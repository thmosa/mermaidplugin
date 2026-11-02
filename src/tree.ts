// Arbetsträdets struktur: vilka rader som finns och hur de hänger ihop. Rena funktioner
// utan vscode, så att de kan testas direkt. extension.ts gör om dem till TreeItems.

import { DiagramModel } from './parser';
import { SequenceModel } from './sequenceParser';

export type Item =
  | { kind: 'subgraph'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'edgeGroup' }
  | { kind: 'edge'; key: string }
  | { kind: 'participants' }
  | { kind: 'block'; id: string }
  | { kind: 'info'; text: string };

const isSequence = (model: DiagramModel): model is SequenceModel => 'blocks' in model;

/** Barnen till `parent`, eller översta nivån. */
export function children(model: DiagramModel, parent?: Item): Item[] {
  if (!model.supported) {
    return parent ? [] : [{ kind: 'info', text: `Diagram type "${model.diagramType}" is not supported yet (only flowchart, state and sequence diagram)` }];
  }
  if (isSequence(model)) return sequenceChildren(model, parent);
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

// Sequence: deltagarna i en egen grupp, sedan flödet där block och grenar är hierarkin.
function sequenceChildren(model: SequenceModel, parent?: Item): Item[] {
  const flow = (container: string | undefined): Item[] => {
    const items: { line: number; item: Item }[] = model.edges
      .filter(e => model.edgeParent[e.index] === container)
      .map(e => ({ line: e.line, item: { kind: 'edge', key: e.key } }));
    for (const b of model.blocks.values()) if (b.parent === container && !b.section) items.push({ line: b.line, item: { kind: 'block', id: b.id } });
    return items.sort((a, b) => a.line - b.line).map(x => x.item);
  };
  if (!parent) return [{ kind: 'participants' }, ...flow(undefined)];
  if (parent.kind === 'participants') {
    const items: Item[] = [...model.subgraphs.values()].sort((a, b) => a.line - b.line).map(sg => ({ kind: 'subgraph', id: sg.id }));
    for (const n of model.nodes.values()) if (!n.subgraph) items.push({ kind: 'node', id: n.id });
    return items;
  }
  if (parent.kind === 'subgraph') return [...model.nodes.values()].filter(n => n.subgraph === parent.id).map(n => ({ kind: 'node', id: n.id }));
  if (parent.kind === 'block') {
    const sections: Item[] = [...model.blocks.values()].filter(b => b.section && b.parent === parent.id).map(b => ({ kind: 'block', id: b.id }));
    return [...flow(parent.id), ...sections];
  }
  return [];
}

export function parentOf(model: DiagramModel, item: Item): Item | undefined {
  if (isSequence(model)) {
    const block = (id: string | undefined): Item | undefined => id ? { kind: 'block', id } : undefined;
    if (item.kind === 'edge') return block(model.edgeParent[model.edges.findIndex(e => e.key === item.key)]);
    if (item.kind === 'block') return block(model.blocks.get(item.id)?.parent);
    if (item.kind === 'subgraph') return { kind: 'participants' };
    if (item.kind === 'node') {
      const sg = model.nodes.get(item.id)?.subgraph;
      return sg ? { kind: 'subgraph', id: sg } : { kind: 'participants' };
    }
    return undefined;
  }
  if (item.kind === 'edge') return { kind: 'edgeGroup' };
  const sg = item.kind === 'node' ? model.nodes.get(item.id)?.subgraph
    : item.kind === 'subgraph' ? model.subgraphs.get(item.id)?.parent
      : undefined;
  return sg ? { kind: 'subgraph', id: sg } : undefined;
}

/** Grupper börjar hopfällda så att stora diagram går att överblicka. */
export function initialState(item: Item): 'collapsed' | 'expanded' | 'none' {
  return item.kind === 'subgraph' || item.kind === 'edgeGroup' || item.kind === 'participants' || item.kind === 'block' ? 'collapsed' : 'none';
}
