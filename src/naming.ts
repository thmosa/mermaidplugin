// Namngivningsregler: id:n som inte följer vald stil varnas, med ett förslag som byter namn
// via samma namnbyte som F2. Rena funktioner utan vscode, så att de kan testas direkt.

import { DiagramModel } from './parser';
import { parseDiagram } from './diagram';
import { occurrences, rename, renamable, renamedId } from './rename';

export type NamingStyle = 'off' | 'camelCase' | 'PascalCase' | 'snake_case';

// Ord: en följd versaler före ett nytt ord (HTTP i HTTPServer), ett ord med gemener, eller bara
// versaler eller siffror. Siffror hör till ordet före (W6, F2).
const WORD = /\p{Lu}+(?=\p{Lu}\p{Ll})\p{N}*|\p{Lu}?\p{Ll}+\p{N}*|\p{Lu}+\p{N}*|\p{N}+/gu;

const capital = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** Namnet skrivet i stilen. */
export function toStyle(name: string, style: NamingStyle): string {
  if (style === 'off') return name;
  const words = (name.match(WORD) ?? []).map(w => w.toLowerCase());
  if (!words.length) return name;
  if (style === 'snake_case') return words.join('_');
  if (style === 'PascalCase') return words.map(capital).join('');
  return words[0] + words.slice(1).map(capital).join('');
}

export interface NamingIssue {
  /** Hela id:t; för en namespace sökvägen (shop.order_items). */
  id: string;
  /** Namnet som står i koden: id:t, eller namespacens sista segment. */
  name: string;
  suggestion: string;
  /** 0-baserad rad och kolumner [start, end) där namnet definieras. */
  line: number;
  start: number;
  end: number;
  /** Om förslaget går att använda (krockar inte med ett annat namn). */
  fixable: boolean;
  message: string;
}

const isClass = (m: DiagramModel) => /^classDiagram/.test(m.diagramType);

/** Namn som inte följer stilen, i textens ordning. */
export function namingIssues(text: string, model: DiagramModel, style: NamingStyle): NamingIssue[] {
  if (style === 'off' || !model.supported) return [];
  const out: NamingIssue[] = [];
  for (const id of renamable(model)) {
    const ns = isClass(model) && model.subgraphs.has(id);
    const name = ns ? id.slice(id.lastIndexOf('.') + 1) : id;
    const suggestion = toStyle(name, style);
    if (suggestion === name) continue;
    const defLine = model.nodes.get(id)?.line ?? model.subgraphs.get(id)?.line;
    const uses = occurrences(text, model, id);
    const at = uses.find(o => o.line === defLine) ?? uses[0];
    if (!at) continue;
    out.push({
      id, name, suggestion, line: at.line, start: at.start, end: at.end,
      fixable: rename(text, model, id, suggestion).error === undefined,
      message: `"${name}" does not follow ${style}. Suggested name: "${suggestion}".`,
    });
  }
  return out.sort((a, b) => a.line - b.line || a.start - b.start);
}

/** Byter namn på varje namn som går att rätta. Ger nya texten och bytena [gammalt id, nytt id]. */
export function fixAll(text: string, style: NamingStyle): { text: string; renamed: [string, string][] } {
  const renamed: [string, string][] = [];
  const tried = new Set<string>();
  for (;;) {
    const model = parseDiagram(text);
    const issue = namingIssues(text, model, style).find(i => i.fixable && !tried.has(i.id));
    if (!issue) return { text, renamed };
    tried.add(issue.id);
    const r = rename(text, model, issue.id, issue.suggestion);
    if (!r.edits) continue;
    const lines = text.split('\n');
    // Bakifrån på varje rad, så att kolumnerna för de andra ändringarna stämmer.
    for (const e of [...r.edits].sort((a, b) => b.line - a.line || b.start - a.start)) {
      lines[e.line] = lines[e.line].slice(0, e.start) + issue.suggestion + lines[e.line].slice(e.end);
    }
    text = lines.join('\n');
    const newId = renamedId(model, issue.id, issue.suggestion);
    renamed.push([issue.id, newId]);
    tried.add(newId);
  }
}
