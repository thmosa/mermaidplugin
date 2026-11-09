// Klick på en pils text i förhandsvisningen: vilken kant i koden gäller det?
// Förhandsvisningen vet bara texten och vilken i ordningen den var bland ritade texter
// med samma lydelse, så kanterna som faktiskt ritas räknas i samma ordning här.

import { DiagramModel, FlowEdge, collapse, visibility } from './parser';
import { SequenceModel, blockSuppressor } from './sequenceParser';

/**
 * Texten som den syns i diagrammet: radbrytningar blir mellanslag, mellanrum slås ihop,
 * och en markdown-sträng ("`...`") visas utan fetstil- och kursivtecken.
 */
export function labelText(s: string): string {
  let t = s.trim();
  if (/^`[^]*`$/.test(t)) t = t.slice(1, -1).replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/([*_])(.+?)\1/g, '$2');
  return t.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
}

const isSequence = (m: DiagramModel): m is SequenceModel => m.diagramType === 'sequenceDiagram';

/** Kanterna som ritas, i kodens ordning. */
export function drawnEdges(model: DiagramModel, hidden: ReadonlySet<string>): FlowEdge[] {
  if (isSequence(model)) {
    const vis = visibility(model, hidden);
    return model.edges.filter(e => !vis.isEdgeHidden(e) && !blockSuppressor(model, hidden, model.edgeParent[e.index]));
  }
  const { kept } = collapse(model, hidden);
  return model.edges.filter(e => kept.has(e.index));
}

/** Kanten vars text är `text`, nummer `nth` (från 0) bland de ritade med samma text. */
export function edgeAtLabel(model: DiagramModel, hidden: ReadonlySet<string>, text: string, nth: number): FlowEdge | undefined {
  const want = labelText(text);
  const same = drawnEdges(model, hidden).filter(e => labelText(e.label) === want);
  return same[Math.min(nth, same.length - 1)];
}

/**
 * Kanten för ett klick på texten `texts[index]`, där `texts` är alla ritade piltexter i SVG:ns ordning.
 * Sequence ritar varje rad i ett meddelande som en egen text, så där räknas raderna i ordning.
 */
export function edgeAtClick(model: DiagramModel, hidden: ReadonlySet<string>, texts: string[], index: number): FlowEdge | undefined {
  if (isSequence(model)) {
    let line = 0;
    for (const e of drawnEdges(model, hidden)) {
      line += e.label.split(/<br\s*\/?>/i).length;
      if (index < line) return e;
    }
    return undefined;
  }
  const want = labelText(texts[index] ?? '');
  const nth = texts.slice(0, index).filter(t => labelText(t) === want).length;
  return edgeAtLabel(model, hidden, want, nth);
}
