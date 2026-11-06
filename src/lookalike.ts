// Tecken som ser likadana ut: kyrilliska och grekiska bokstäver som ser ut som latinska, och breda
// tecken (Ｏ). Mermaid ser dem som andra tecken, så "Оrder" med kyrilliskt О blir en annan nod än
// "Order" fast det inte syns i koden. Rena funktioner utan vscode, så att de kan testas direkt.

import { DiagramModel } from './parser';
import { IdRange, occurrences, rename, renamable, renamedId } from './rename';

// Bokstäver som ser ut som en latinsk bokstav i vanliga typsnitt.
const CYRILLIC = 'аaеeоoрpсcуyхxіiјjѕsԁdһhԛqԝwӏlАAВBЕEКKМMНHОOРPСCТTХXУYІIЈJЅSԚQԜW';
const GREEK = 'ΑAΒBΕEΖZΗHΙIΚKΜMΝNΟOΡPΤTΥYΧXοo';
const TABLE = new Map<string, string>();
for (const s of [CYRILLIC, GREEK]) for (let i = 0; i < s.length; i += 2) TABLE.set(s[i], s[i + 1]);

/** Breda tecken (U+FF01–U+FF5E) motsvarar ASCII-tecknen 0xFEE0 lägre. */
const isWide = (c: string) => c >= '！' && c <= '～';
const latinOf = (c: string) => isWide(c) ? String.fromCharCode(c.charCodeAt(0) - 0xFEE0) : TABLE.get(c);

/** Namnet med varje tecken som ser latinskt ut ersatt med den latinska bokstaven. */
export function latinLookalike(name: string): string {
  return [...name].map(c => latinOf(c) ?? c).join('');
}

const scriptOf = (c: string) => isWide(c) ? 'full-width' : c >= 'Ͱ' && c <= 'Ͽ' ? 'Greek' : 'Cyrillic';

export interface LookalikeIssue {
  /** Hela id:t; för en namespace sökvägen. */
  id: string;
  /** Namnet som står i koden: id:t, eller namespacens sista segment. */
  name: string;
  /** Namnet med latinska bokstäver. */
  suggestion: string;
  /** Det befintliga id:t som namnet ser ut som; rättningen slår ihop dem. */
  merges?: string;
  /** Varje användning av namnet. */
  ranges: IdRange[];
  /** Om rättningen går att göra (förslaget är inget reserverat ord och krockar inte annars). */
  fixable: boolean;
  message: string;
}

const isClass = (m: DiagramModel) => /^classDiagram/.test(m.diagramType);

/** Namn med tecken som ser latinska ut men inte är det, i textens ordning. */
export function lookalikeIssues(text: string, model: DiagramModel): LookalikeIssue[] {
  if (!model.supported) return [];
  const ids = renamable(model);
  const out: LookalikeIssue[] = [];
  for (const id of ids) {
    const ns = isClass(model) && model.subgraphs.has(id);
    const name = ns ? id.slice(id.lastIndexOf('.') + 1) : id;
    const odd = [...new Set([...name].filter(c => latinOf(c) !== undefined))];
    if (!odd.length) continue;
    const suggestion = latinLookalike(name);
    const target = renamedId(model, id, suggestion);
    const merges = target !== id && ids.includes(target) ? target : undefined;
    // Ett helt kyrilliskt eller grekiskt namn kan vara ett riktigt ord (СССР); det varnas bara när
    // det ser ut som ett annat namn. Breda tecken och blandade alfabet är nästan alltid misstag.
    const mixed = /\p{Script=Latin}/u.test(name);
    if (!merges && !mixed && !odd.some(isWide)) continue;
    const ranges = occurrences(text, model, id);
    if (!ranges.length) continue;
    const what = odd.map(c => `${scriptOf(c)} "${c}" that looks like Latin "${latinOf(c)}"`).join(', ');
    const message = merges
      ? `"${name}" looks the same as "${merges.slice(merges.lastIndexOf('.') + 1)}" but has ${what}. Mermaid treats them as different names.`
      : `"${name}" has ${what}. Suggested name: "${suggestion}".`;
    out.push({
      id, name, suggestion, merges, ranges, message,
      fixable: merges !== undefined || rename(text, model, id, suggestion).error === undefined,
    });
  }
  return out.sort((a, b) => a.ranges[0].line - b.ranges[0].line || a.ranges[0].start - b.ranges[0].start);
}
