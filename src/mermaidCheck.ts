// Kör Mermaids egen parser i Node (tilläggets process), så att syntaxfel kan visas
// i editorn även när förhandsvisningen är stängd. Mermaid är en ES-modul och laddas
// först när den behövs.

import * as path from 'path';
import { pathToFileURL } from 'url';

/** Ett fel från Mermaid. Radnumren är Mermaids egna (1-baserade, efter dess förbehandling). */
export interface MermaidError {
  kind: 'parse' | 'unknownDiagram';
  message: string;
  firstLine?: number;
  lastLine?: number;
  /** Texten Mermaid stannade på, om den finns. */
  text?: string;
}

interface MermaidApi { parse(text: string): Promise<unknown> }

// TypeScript gör om import() till require() i CommonJS; Function behåller den riktiga import().
const importEsm = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<{ default: MermaidApi }>;
let loading: Promise<MermaidApi> | undefined;

function mermaid(): Promise<MermaidApi> {
  const file = path.join(__dirname, '..', 'node_modules', 'mermaid', 'dist', 'mermaid.core.mjs');
  loading ??= importEsm(pathToFileURL(file).href).then(m => m.default);
  return loading;
}

/**
 * Kontrollerar syntaxen. Ger null om diagrammet är giltigt, eller om Mermaid kraschade
 * av något annat skäl än ett syntaxfel (t.ex. markdown-strängar, som kräver en webbläsare).
 */
export async function checkSyntax(text: string): Promise<MermaidError | null> {
  const api = await mermaid();
  try {
    await api.parse(text);
    return null;
  } catch (e) {
    const err = e as { name?: string; message?: string; hash?: { loc?: { first_line: number; last_line: number }; text?: string } };
    const message = String(err?.message ?? e);
    if (err?.name === 'UnknownDiagramError') return { kind: 'unknownDiagram', message };
    const loc = err?.hash?.loc;
    if (!loc) return null;
    return { kind: 'parse', message, firstLine: loc.first_line, lastLine: loc.last_line, text: err.hash?.text || undefined };
  }
}
