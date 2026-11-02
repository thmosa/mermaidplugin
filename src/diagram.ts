// Väljer parser och filter efter diagramtyp, så att tillägget inte behöver veta vilken typ det är.

import { FlowModel, parseFlowchart, filterFlowchart } from './parser';
import { StateModel, parseState, filterState } from './stateParser';
import { SequenceModel, SequenceRender, parseSequence, filterSequence, filterSequenceDetailed } from './sequenceParser';

export type AnyModel = FlowModel | StateModel | SequenceModel;

export function parseDiagram(text: string): AnyModel {
  const flow = parseFlowchart(text);
  if (flow.supported) return flow;
  for (const parse of [parseState, parseSequence]) {
    const m = parse(text);
    if (m.supported) return m;
  }
  return flow;
}

export function filterDiagram(model: AnyModel, hidden: ReadonlySet<string>): string {
  if (/^stateDiagram/.test(model.diagramType)) return filterState(model as StateModel, hidden);
  if (model.diagramType === 'sequenceDiagram') return filterSequence(model as SequenceModel, hidden);
  return filterFlowchart(model as FlowModel, hidden);
}

/** Det förhandsvisningen behöver: texten och, för sequence, vilka block som ritas i SVG-ordning. */
export function renderInfo(model: AnyModel, hidden: ReadonlySet<string>): SequenceRender {
  if (model.diagramType === 'sequenceDiagram') return filterSequenceDetailed(model as SequenceModel, hidden);
  return { text: filterDiagram(model, hidden), blocks: [], rects: [], sections: {} };
}
