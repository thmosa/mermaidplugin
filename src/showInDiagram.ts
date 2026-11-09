// Show in Diagram: vilket element en plats i koden gäller, och hur det ska visas i bilden.
// Rena funktioner utan vscode, så att de kan testas direkt.

import { DiagramModel, FlowEdge, collapse, subgraphKey, visibility } from './parser';
import { idAt } from './rename';
import { drawnEdges, labelText } from './edgeClick';
import { SequenceModel } from './sequenceParser';
import { ClassModel } from './classParser';

export type Target =
  | { kind: 'node'; id: string }
  | { kind: 'subgraph'; id: string }
  | { kind: 'block'; id: string }
  | { kind: 'edge'; edge: FlowEdge };

/** Det som ska markeras i bilden, eller namnet på det som är dolt. */
export type Shown =
  | { kind: 'node' | 'subgraph' | 'block'; id: string }
  | { kind: 'edgeText'; text: string; nth: number }
  | { kind: 'edgeText'; index: number }
  | { hidden: string };

const isSequence = (m: DiagramModel): m is SequenceModel => m.diagramType === 'sequenceDiagram';
const isClass = (m: DiagramModel): m is ClassModel => /^classDiagram/.test(m.diagramType);

/** Elementet på en plats i koden: namnet under markören i första hand, annars det raden gäller. */
export function targetAt(text: string, model: DiagramModel, line: number, character: number): Target | undefined {
  if (!model.supported) return undefined;
  const hit = idAt(text, model, line, character);
  if (hit) return { kind: model.subgraphs.has(hit.id) ? 'subgraph' : 'node', id: hit.id };
  if (isSequence(model)) {
    for (const b of model.blocks.values()) {
      if (b.line === line || b.endLine === line) return { kind: 'block', id: b.section ? b.parent! : b.id };
    }
  }
  for (const g of model.subgraphs.values()) {
    if (g.line === line || g.endLine === line) return { kind: 'subgraph', id: g.id };
  }
  if (isClass(model)) {
    const l = model.lines[line];
    if (l && 'id' in l && l.kind !== 'nsStart') return { kind: 'node', id: l.id };
  }
  const edge = model.edges.find(e => e.line === line);
  if (edge) return { kind: 'edge', edge };
  for (const n of model.nodes.values()) if (n.line === line && !n.pseudo) return { kind: 'node', id: n.id };
  return undefined;
}

/** Hur elementet visas just nu: dolt, som sin hopfällda grupp, eller som sig självt. */
export function resolveTarget(model: DiagramModel, hidden: ReadonlySet<string>, target: Target): Shown {
  const vis = visibility(model, hidden);
  const owner = (id: string) => isSequence(model) ? undefined : collapse(model, hidden).owner(id);
  const node = (id: string): Shown => {
    if (vis.isNodeHidden(id)) return { hidden: id };
    const group = owner(id);
    return group !== undefined ? { kind: 'subgraph', id: group } : { kind: 'node', id };
  };
  if (target.kind === 'node') return node(target.id);
  if (target.kind === 'subgraph') {
    if (vis.isSubgraphHidden(target.id)) return { hidden: target.id };
    return { kind: 'subgraph', id: owner(target.id) ?? target.id };
  }
  if (target.kind === 'block') {
    const blocks = (model as SequenceModel).blocks;
    for (let cur: string | undefined = target.id; cur; cur = blocks.get(cur)?.parent) {
      if (hidden.has(subgraphKey(cur))) return { hidden: target.id };
    }
    return { kind: 'block', id: target.id };
  }
  const { edge } = target;
  if (vis.isEdgeHidden(edge)) return { hidden: `${edge.from} → ${edge.to}` };
  const drawn = drawnEdges(model, hidden);
  const at = drawn.findIndex(e => e.index === edge.index);
  const text = labelText(edge.label);
  if (at < 0 || !text) return node(edge.from);
  if (isSequence(model)) {
    // Sequence ritar varje rad i ett meddelande som en egen text.
    return { kind: 'edgeText', index: drawn.slice(0, at).reduce((n, e) => n + e.label.split(/<br\s*\/?>/i).length, 0) };
  }
  return { kind: 'edgeText', text, nth: drawn.slice(0, at).filter(e => labelText(e.label) === text).length };
}
