// Översätter Mermaids syntaxfel till en plats i filen. Rena funktioner utan vscode.

import { MermaidError } from './mermaidCheck';

export interface SyntaxDiagnostic {
  /** 0-baserad rad och kolumner [start, end). */
  line: number;
  start: number;
  end: number;
  message: string;
}

/**
 * Raderna i filen som Mermaid räknar, i ordning (0-baserade index). Mermaid tar bort
 * front matter, alla %%-rader och tomma rader före diagramrubriken innan den räknar.
 */
function countedLines(src: string[]): number[] {
  let i = 0;
  if (src[0]?.trim() === '---') {
    for (i = 1; i < src.length && src[i].trim() !== '---'; i++);
    i++;
  }
  const out: number[] = [];
  for (; i < src.length; i++) {
    const t = src[i].trim();
    if (t.startsWith('%%')) continue;
    if (t === '' && out.length === 0) continue;
    out.push(i);
  }
  return out;
}

/** Filens rad (0-baserad) för Mermaids rad (1-baserad). */
export function documentLine(text: string, mermaidLine: number): number {
  const src = text.split(/\r?\n/);
  const counted = countedLines(src);
  const at = counted[mermaidLine - 1];
  if (at !== undefined) return at;
  const nonEmpty = counted.filter(i => src[i].trim() !== '');
  return nonEmpty[nonEmpty.length - 1] ?? 0;
}

const wholeLine = (line: string) => {
  const start = line.length - line.trimStart().length;
  return { start, end: line.trimEnd().length };
};

export function syntaxDiagnostic(err: MermaidError, text: string): SyntaxDiagnostic | null {
  const src = text.split(/\r?\n/);
  if (err.kind === 'unknownDiagram') {
    const header = countedLines(src).find(i => src[i].trim() !== '');
    if (header === undefined) return null;
    return {
      line: header, ...wholeLine(src[header]),
      message: `Unknown diagram type. The first line must name one, e.g. "flowchart LR" or "stateDiagram-v2".\n\n${err.message}`,
    };
  }
  const line = documentLine(text, err.firstLine ?? 1);
  const content = src[line] ?? '';
  const at = err.text ? content.indexOf(err.text) : -1;
  const range = at >= 0 ? { start: at, end: at + err.text!.length } : wholeLine(content);
  const near = at >= 0 ? ` near "${err.text}"` : '';
  return { line, ...range, message: `Mermaid syntax error${near}.\n\n${err.message}` };
}
