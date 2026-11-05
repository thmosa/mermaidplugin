// Semantisk färgläggning: parsern vet vad varje namn är, så temat kan färga rätt även där
// grammatiken bara gissar utifrån mönster. Rena funktioner utan vscode, så att de kan testas direkt.
//
// Typerna är VS Codes standardtyper. "variable" används inte: den blir grå som vanlig text i
// standardtemat 2026 Dark, medan type, class och namespace får egna färger i alla inbyggda teman.

import { DiagramModel } from './parser';
import { occurrences, renamable } from './rename';

export const LEGEND = { tokenTypes: ['type', 'class', 'namespace'], tokenModifiers: ['declaration'] };

export interface SemanticToken {
  line: number;
  start: number;
  length: number;
  type: string;
  modifiers: string[];
}

/** En token för varje användning av ett namn, i textens ordning. */
export function semanticTokens(text: string, model: DiagramModel): SemanticToken[] {
  if (!model.supported) return [];
  const isClass = /^classDiagram/.test(model.diagramType);
  const out: SemanticToken[] = [];
  for (const id of renamable(model)) {
    const group = model.subgraphs.has(id);
    const type = group ? 'namespace' : isClass ? 'class' : 'type';
    const defLine = model.nodes.get(id)?.line ?? model.subgraphs.get(id)?.line;
    let declared = false;
    for (const o of occurrences(text, model, id)) {
      const declaration = !declared && o.line === defLine;
      if (declaration) declared = true;
      out.push({ line: o.line, start: o.start, length: o.end - o.start, type, modifiers: declaration ? ['declaration'] : [] });
    }
  }
  return out.sort((a, b) => a.line - b.line || a.start - b.start);
}
