// Flera klassdiagram ritade tillsammans. Mermaid gör redan klasser med samma namn till en, men
// visar en medlem eller relation som står i två filer två gånger, och låter tyst sista etiketten
// vinna. Här tas dubbletterna bort och krockarna rapporteras. Rena funktioner utan vscode.

import { parseClass } from './classParser';

export interface SourceFile {
  /** Namnet som visas i varningar och i den sammanslagna texten. */
  name: string;
  text: string;
}

export interface SourceLine {
  /** Index i listan med filer. */
  file: number;
  /** 0-baserad rad i filen. */
  line: number;
}

export interface MergeConflict {
  /** 0-baserad rad i den sammanslagna texten. */
  line: number;
  message: string;
}

export interface MergeResult {
  text: string;
  /** Varifrån varje rad i texten kommer; undefined för rader som bara finns i sammanslagningen. */
  sources: (SourceLine | undefined)[];
  conflicts: MergeConflict[];
  /** Varför filerna inte går att slå ihop. */
  error?: string;
}

const squeeze = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Slår ihop klassdiagrammen till en text. Bara dubbletter mellan filer tas bort. */
export function mergeClassDiagrams(files: SourceFile[]): MergeResult {
  const models = files.map(f => parseClass(f.text));
  const bad = models.findIndex(m => !m.supported);
  if (bad >= 0) return { text: '', sources: [], conflicts: [], error: `"${files[bad].name}" is not a class diagram.` };

  const out: string[] = ['classDiagram'];
  const sources: (SourceLine | undefined)[] = [undefined];
  const emit = (text: string, source?: SourceLine) => { out.push(text); sources.push(source); return out.length - 1; };
  const conflicts: MergeConflict[] = [];

  // Riktningen måste stå en gång; den första som finns gäller.
  let direction: { value: string; file: number; line: number } | undefined;
  const directionOf = (text: string) => /^direction\s+(\w+)$/.exec(text.trim())?.[1];
  models.forEach((m, file) => {
    const line = m.lines.findIndex(l => l.kind === 'raw' && directionOf(l.text) !== undefined);
    if (line >= 0 && !direction) direction = { value: directionOf(m.lines[line].text)!, file, line };
  });
  if (direction) {
    const { value, file, line } = direction;
    const at = emit(models[file].lines[line].text, { file, line });
    models.forEach((m, i) => {
      for (const l of m.lines) {
        const other = l.kind === 'raw' ? directionOf(l.text) : undefined;
        if (other !== undefined && other !== value) {
          conflicts.push({ line: at, message: `${files[i].name} uses direction ${other}, but ${value} from ${files[file].name} is used.` });
        }
      }
    });
  }

  const seen = new Set<string>();
  const labels = new Map<string, { label: string; file: number }>();
  const spaces = new Map<string, { ns: string; file: number }>();

  models.forEach((m, file) => {
    emit(`  %% ---- ${files[file].name} ----`);
    const here = new Set<string>();
    const merged = new Map<number, number>();
    // Filhuvud och %%{init}%% före diagramtypen skulle krocka mellan filerna.
    const header = m.lines.findIndex(l => l.kind === 'raw' && /^classDiagram/.test(l.text.trim()));
    let rel = 0;
    m.lines.forEach((l, line) => {
      if (line <= header) return;
      let key: string | undefined;
      switch (l.kind) {
        case 'raw':
          if (!l.text.trim() || l.text.trim().startsWith('%%') || directionOf(l.text) !== undefined) return;
          break;
        case 'body':
          key = `member\0${l.id}\0${squeeze(l.text)}`;
          break;
        case 'member':
          key = `member\0${l.id}\0${squeeze(l.text.slice(l.text.indexOf(':') + 1))}`;
          break;
        case 'annotation':
          key = `member\0${l.id}\0${squeeze(/<<.+?>>/.exec(l.text)![0])}`;
          break;
        case 'noteFor':
          key = `note\0${squeeze(l.text)}`;
          break;
        case 'rel': {
          const e = m.edges[rel++];
          key = ['rel', e.from, l.fromCard ?? '', l.arrow, l.toCard ?? '', e.to, e.label].join('\0');
          break;
        }
      }
      if (key !== undefined) {
        if (seen.has(key)) return;
        here.add(key);
      }
      merged.set(line, emit(l.text, { file, line }));
    });
    for (const k of here) seen.add(k);

    for (const n of m.nodes.values()) {
      const at = merged.get(n.line) ?? 0;
      if (n.label !== n.id) {
        const first = labels.get(n.id);
        if (!first) labels.set(n.id, { label: n.label, file });
        else if (first.label !== n.label) {
          conflicts.push({ line: at, message: `"${n.id}" is labeled "${first.label}" in ${files[first.file].name} and "${n.label}" in ${files[file].name}. Mermaid shows the last one.` });
        }
      }
      if (n.subgraph !== undefined) {
        const first = spaces.get(n.id);
        if (!first) spaces.set(n.id, { ns: n.subgraph, file });
        else if (first.ns !== n.subgraph) {
          conflicts.push({ line: at, message: `"${n.id}" is in namespace ${first.ns} in ${files[first.file].name} and ${n.subgraph} in ${files[file].name}. A class can only be drawn in one.` });
        }
      }
    }
  });

  return { text: out.join('\n'), sources, conflicts };
}
