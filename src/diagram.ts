// Väljer parser och filter efter diagramtyp, så att tillägget inte behöver veta vilken typ det är.

import { FlowModel, parseFlowchart, filterFlowchart } from './parser';
import { StateModel, parseState, filterState } from './stateParser';

export type AnyModel = FlowModel | StateModel;

const isState = (m: AnyModel): m is StateModel => /^stateDiagram/.test(m.diagramType);

export function parseDiagram(text: string): AnyModel {
  const flow = parseFlowchart(text);
  if (flow.supported) return flow;
  const state = parseState(text);
  return state.supported ? state : flow;
}

export function filterDiagram(model: AnyModel, hidden: ReadonlySet<string>): string {
  return isState(model) ? filterState(model, hidden) : filterFlowchart(model as FlowModel, hidden);
}
