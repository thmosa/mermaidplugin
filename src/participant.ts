// "Change Participant": byter en enda förekomst av en deltagare i ett sequence diagram mot en
// annan befintlig deltagare. Rena funktioner utan vscode, så att de kan testas direkt.

import { DiagramModel } from './parser';
import { IdRange, idAt } from './rename';
import { SequenceModel } from './sequenceParser';

// Deklarationer byter man inte här: det vore ett namnbyte (Rename) eller en ny deltagare.
const DECLARATION = /^\s*(?:create\s+)?(?:participant|actor)\b|^\s*destroy\b/;

/**
 * Deltagaren vid markören (i meddelanden, anteckningar, activate …). `blocked` säger varför den inte
 * går att byta: Mermaid kräver att meddelandet efter create och destroy har med den deltagaren.
 */
export function participantAt(text: string, model: DiagramModel, line: number, character: number): (IdRange & { blocked?: string }) | undefined {
  if (model.diagramType !== 'sequenceDiagram') return undefined;
  if (DECLARATION.test(text.split(/\r?\n/)[line] ?? '')) return undefined;
  const hit = idAt(text, model, line, character);
  if (!hit || !model.nodes.has(hit.id)) return undefined;
  for (const l of (model as SequenceModel).lines) {
    if ((l.kind !== 'create' && l.kind !== 'destroy') || l.id !== hit.id || l.edge === undefined) continue;
    if (model.edges[l.edge]?.line === line) {
      return { ...hit, blocked: `"${hit.id}" must stay in this message, because it is the message right after ${l.kind} ${hit.id}.` };
    }
  }
  return hit;
}

/** Deltagarna att välja mellan: alla utom den som står där, i diagrammets ordning. */
export function participantChoices(model: DiagramModel, current: string): { id: string; label: string }[] {
  return [...model.nodes.values()].filter(n => n.id !== current).map(n => ({ id: n.id, label: n.label }));
}
