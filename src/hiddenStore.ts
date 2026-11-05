// Vad som är dolt och hopfällt per fil. Som standard bara medan filen är öppen, så att allt syns
// när den öppnas igen; med inställningen mermaidTree.rememberHiddenState sparas det i arbetsytan.

/** Det som behövs av VS Codes workspaceState. */
export interface Memento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

const KEY = 'mermaidTree.hidden';

export class HiddenStore {
  private readonly open = new Map<string, string[]>();

  constructor(private readonly backing: Memento, private readonly remember: () => boolean) {}

  load(uri: string): string[] {
    if (!this.remember()) return this.open.get(uri) ?? [];
    return this.backing.get<Record<string, string[]>>(KEY, {})[uri] ?? [];
  }

  save(uri: string, keys: string[]) {
    if (!this.remember()) { this.open.set(uri, keys); return; }
    const saved = { ...this.backing.get<Record<string, string[]>>(KEY, {}) };
    saved[uri] = keys;
    void this.backing.update(KEY, saved);
  }

  /** Filen har stängts. */
  forget(uri: string) {
    this.open.delete(uri);
  }
}
