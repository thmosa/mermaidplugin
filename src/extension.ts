import * as vscode from 'vscode';
import { FlowEdge, visibility, neighborhood, nodeKey, edgeKey, subgraphKey, collapseKey } from './parser';
import { AnyModel, parseDiagram, renderInfo } from './diagram';
import { SequenceModel, SequenceRender, blockSuppressor } from './sequenceParser';
import { caseConflicts } from './diagnostics';
import { checkSyntax } from './mermaidCheck';
import { syntaxDiagnostic } from './syntax';
import { Item, children, parentOf, initialState, countMatches } from './tree';
import { idAt, occurrences, rename, renameKeys, renamedId } from './rename';
import { edgeAtClick } from './edgeClick';
import { HiddenStore } from './hiddenStore';
import { NamingStyle, namingIssues, fixAll, similarNames } from './naming';
import { lookalikeIssues } from './lookalike';
import { MergeConflict, MergeResult, mergeClassDiagrams } from './mergeClass';
import { Shown, Target, resolveTarget, targetAt } from './showInDiagram';
import { participantAt, participantChoices, participantCompletion } from './participant';
import { LEGEND, semanticTokens } from './semantic';

const SEMANTIC_LEGEND = new vscode.SemanticTokensLegend(LEGEND.tokenTypes, LEGEND.tokenModifiers);


function isMermaid(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'mermaid' || /\.(mmd|mermaid)$/i.test(doc.fileName);
}

// ---------------------------------------------------------------- flera klassdiagram tillsammans

const COMBINED_SCHEME = 'mermaid-combined';
const READ_ONLY = 'A combined view is read-only. Change the names in the source files.';

/** Skrivskyddade dokument med flera klassdiagram ihopslagna. Källfilerna står i adressen. */
class CombinedViews implements vscode.TextDocumentContentProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  private readonly open = new Map<string, { uri: vscode.Uri; files: vscode.Uri[]; merge: MergeResult }>();

  static uriFor(files: vscode.Uri[]): vscode.Uri {
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
    const names = sorted.map(f => f.path.slice(f.path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''));
    const shown = names.length > 3 ? `${names.slice(0, 3).join(' + ')} + ${names.length - 3} more` : names.join(' + ');
    return vscode.Uri.from({ scheme: COMBINED_SCHEME, path: `/${shown}.mmd`, query: JSON.stringify(sorted.map(String)) });
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const files = (JSON.parse(uri.query) as string[]).map(s => vscode.Uri.parse(s));
    let merge: MergeResult;
    try {
      const docs = await Promise.all(files.map(f => vscode.workspace.openTextDocument(f)));
      merge = mergeClassDiagrams(docs.map(d => ({ name: vscode.workspace.asRelativePath(d.uri), text: d.getText() })));
    } catch (e) {
      merge = { text: '', sources: [], conflicts: [], error: String((e as Error).message) };
    }
    this.open.set(uri.toString(), { uri, files, merge });
    return merge.error ? `%% ${merge.error}` : merge.text;
  }

  /** Filen och raden som en rad i vyn kommer från. */
  source(uri: vscode.Uri, line: number): { file: vscode.Uri; line: number } | undefined {
    const view = this.open.get(uri.toString());
    const src = view?.merge.sources[line];
    return view && src ? { file: view.files[src.file], line: src.line } : undefined;
  }

  conflicts(uri: vscode.Uri): MergeConflict[] {
    return this.open.get(uri.toString())?.merge.conflicts ?? [];
  }

  /** Om filen ingår i vyn. */
  includes(uri: vscode.Uri, file: vscode.Uri): boolean {
    return this.open.get(uri.toString())?.files.some(f => f.toString() === file.toString()) ?? false;
  }

  /** En källfil har ändrats: rita om vyerna den ingår i. */
  sourceChanged(file: vscode.Uri) {
    for (const v of this.open.values()) if (this.includes(v.uri, file)) this.changed.fire(v.uri);
  }

  closed(uri: vscode.Uri) {
    this.open.delete(uri.toString());
  }
}

// ---------------------------------------------------------------- tillstånd

/** Aktuellt diagram, dess modell och vilka element som är dolda. */
class DiagramState {
  doc: vscode.TextDocument | undefined;
  model: AnyModel | undefined;
  hidden = new Set<string>();

  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  private readonly store: HiddenStore;

  constructor(ctx: vscode.ExtensionContext) {
    this.store = new HiddenStore(ctx.workspaceState,
      () => vscode.workspace.getConfiguration('mermaidTree').get<boolean>('rememberHiddenState', false));
  }

  setDocument(doc: vscode.TextDocument) {
    if (this.doc?.uri.toString() === doc.uri.toString()) return;
    this.doc = doc;
    this.hidden = new Set(this.store.load(doc.uri.toString()));
    this.reparse();
  }

  reparse() {
    this.model = this.doc ? parseDiagram(this.doc.getText()) : undefined;
    this.changed.fire();
  }

  /** Filen har stängts: nästa gång den öppnas syns allt (om inställningen inte säger annat). */
  closed(uri: vscode.Uri) {
    this.store.forget(uri.toString());
    if (this.doc?.uri.toString() !== uri.toString()) return;
    this.hidden = new Set(this.store.load(uri.toString()));
    this.changed.fire();
  }

  setVisible(keys: string[], visible: boolean) {
    for (const k of keys) visible ? this.hidden.delete(k) : this.hidden.add(k);
    this.commit();
  }

  /** Byter ut vad som är dolt. Hopfällda grupper (c:-nycklar) ligger kvar. */
  replaceHidden(keys: Iterable<string>) {
    this.hidden = new Set([...[...this.hidden].filter(k => k.startsWith('c:')), ...keys]);
    this.commit();
  }

  /** Efter ett namnbyte: dolt och hopfällt pekar på det nya id:t. */
  renameKeys(oldId: string, newId: string) {
    this.hidden = renameKeys(this.hidden, oldId, newId);
    this.commit();
  }

  setCollapsed(sgId: string, collapsed: boolean) {
    collapsed ? this.hidden.add(collapseKey(sgId)) : this.hidden.delete(collapseKey(sgId));
    this.commit();
  }

  /** Texten att rendera, och för sequence vilka block som ritas och vilka av dem som är hopfällda. */
  rendered(): SequenceRender & { collapsed: string[] } {
    if (!this.doc || !this.model) return { text: '', blocks: [], rects: [], sections: {}, collapsed: [] };
    const info = renderInfo(this.model, this.hidden);
    const drawn = [...info.blocks, ...info.rects, ...Object.values(info.sections).flat(), ...info.blocks.map(id => `${id}:0`)];
    return { ...info, collapsed: drawn.filter(id => this.hidden.has(collapseKey(id))) };
  }

  private commit() {
    if (this.doc) this.store.save(this.doc.uri.toString(), [...this.hidden]);
    this.changed.fire();
  }
}

// ---------------------------------------------------------------- arbetsträd

const COLLAPSIBLE = {
  collapsed: vscode.TreeItemCollapsibleState.Collapsed,
  expanded: vscode.TreeItemCollapsibleState.Expanded,
  none: vscode.TreeItemCollapsibleState.None,
};

const itemKey = (i: Item) =>
  i.kind === 'edge' ? edgeKey(i.key)
    : i.kind === 'node' ? nodeKey(i.id)
      : i.kind === 'subgraph' || i.kind === 'block' ? subgraphKey(i.id)
        : i.kind;

const isSequence = (m: AnyModel): m is SequenceModel => m.diagramType === 'sequenceDiagram';

// Ikoner för blocken i ett sequence diagram.
const BLOCK_ICONS: Record<string, string> = {
  loop: 'sync', alt: 'question', opt: 'question', par: 'split-horizontal', par_over: 'split-horizontal',
  critical: 'warning', break: 'debug-stop', rect: 'symbol-color',
};

class StructureProvider implements vscode.TreeDataProvider<Item> {
  private readonly changed = new vscode.EventEmitter<Item | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  /** Samma objekt måste återanvändas för att reveal() ska hitta rätt rad i trädet. */
  private items = new Map<string, Item>();
  /** Sökningen som trädet filtreras på; tom när man inte söker. */
  query = '';

  constructor(private readonly state: DiagramState) {
    state.onDidChange(() => { this.items.clear(); this.changed.fire(undefined); });
  }

  setQuery(query: string) {
    this.query = query.trim();
    this.items.clear();
    this.changed.fire(undefined);
  }

  item(i: Item): Item {
    const k = itemKey(i);
    const existing = this.items.get(k);
    if (existing) return existing;
    this.items.set(k, i);
    return i;
  }

  find(kind: 'node' | 'subgraph' | 'block', id: string): Item | undefined {
    const m = this.state.model;
    if (!m) return undefined;
    if (kind === 'block' && isSequence(m) && m.blocks.has(id)) return this.item({ kind, id });
    if (kind === 'node' && m.nodes.has(id)) return this.item({ kind, id });
    if (kind === 'subgraph' && m.subgraphs.has(id)) return this.item({ kind, id });
    return undefined;
  }

  getChildren(parent?: Item): Item[] {
    const m = this.state.model;
    return m ? children(m, parent, this.query).map(i => this.item(i)) : [];
  }

  getParent(i: Item): Item | undefined {
    const m = this.state.model;
    const p = m && parentOf(m, i);
    return p ? this.item(p) : undefined;
  }

  getTreeItem(i: Item): vscode.TreeItem {
    const t = this.treeItem(i);
    if (!this.query) return t;
    // Under sökning: grupperna fälls ut (nytt id, så att VS Code inte minns det hopfällda läget)
    // och träffen markeras i namnet.
    if (t.id) t.id += `?search=${this.query}`;
    if (t.collapsibleState !== vscode.TreeItemCollapsibleState.None) t.collapsibleState = COLLAPSIBLE[initialState(i, true)];
    const label = typeof t.label === 'string' ? t.label : undefined;
    const at = label?.toLowerCase().indexOf(this.query.toLowerCase()) ?? -1;
    if (label && at >= 0) t.label = { label, highlights: [[at, at + this.query.length]] };
    return t;
  }

  private treeItem(i: Item): vscode.TreeItem {
    const m = this.state.model!;
    const vis = visibility(m, this.state.hidden);
    const check = (hidden: boolean) => hidden ? vscode.TreeItemCheckboxState.Unchecked : vscode.TreeItemCheckboxState.Checked;
    const label = (id: string) => m.nodes.get(id)?.label ?? m.subgraphs.get(id)?.title ?? id;
    // Ord och ikoner efter diagramtyp. Sequence-box kan inte fällas ihop (inget kontextvärde för det).
    const words = /^stateDiagram/.test(m.diagramType)
      ? { group: 'composite state', node: 'state', edges: 'Transitions', groupIcon: 'symbol-class', nodeIcon: 'symbol-constant', groupItem: 'subgraph' }
      : m.diagramType === 'sequenceDiagram'
        ? { group: 'box', node: 'participant', edges: 'Messages', groupIcon: 'package', nodeIcon: 'person', groupItem: 'box' }
        : /^classDiagram/.test(m.diagramType)
          ? { group: 'namespace', node: 'class', edges: 'Relations', groupIcon: 'symbol-namespace', nodeIcon: 'symbol-class', groupItem: 'subgraph' }
          : { group: 'subgraph', node: 'node', edges: 'Edges', groupIcon: 'symbol-namespace', nodeIcon: 'symbol-constant', groupItem: 'subgraph' };

    switch (i.kind) {
      case 'info': {
        const t = new vscode.TreeItem(i.text);
        t.iconPath = new vscode.ThemeIcon('info');
        return t;
      }
      case 'subgraph': {
        const sg = m.subgraphs.get(i.id)!;
        const t = new vscode.TreeItem(sg.title, COLLAPSIBLE[initialState(i)]);
        t.id = subgraphKey(i.id);
        const collapsed = this.state.hidden.has(collapseKey(i.id));
        t.iconPath = new vscode.ThemeIcon(words.groupIcon);
        t.contextValue = words.groupItem === 'box' ? 'box' : collapsed ? 'subgraphCollapsed' : 'subgraph';
        t.checkboxState = check(this.state.hidden.has(subgraphKey(i.id)));
        const notes: string[] = [];
        if (sg.title !== i.id) notes.push(i.id);
        if (!this.state.hidden.has(subgraphKey(i.id)) && vis.isSubgraphHidden(i.id)) notes.push('hidden by parent');
        else if (collapsed) notes.push('collapsed in diagram');
        t.description = notes.join(' · ');
        return t;
      }
      case 'node': {
        const n = m.nodes.get(i.id)!;
        const t = new vscode.TreeItem(n.label);
        t.id = nodeKey(i.id);
        t.iconPath = new vscode.ThemeIcon(n.pseudo === 'start' ? 'debug-start' : n.pseudo === 'end' ? 'debug-stop' : words.nodeIcon);
        t.contextValue = 'node';
        t.checkboxState = check(this.state.hidden.has(nodeKey(i.id)));
        const viaParent = !this.state.hidden.has(nodeKey(i.id)) && vis.isNodeHidden(i.id);
        t.description = [n.label !== n.id && !n.pseudo ? n.id : '', viaParent ? `hidden by ${words.group}` : ''].filter(Boolean).join(' · ');
        t.tooltip = `${n.id} – line ${n.line + 1}`;
        return t;
      }
      case 'edgeGroup': {
        const hiddenCount = m.edges.filter(e => vis.isEdgeHidden(e)).length;
        const t = new vscode.TreeItem(words.edges, COLLAPSIBLE[initialState(i)]);
        t.id = 'edgeGroup';
        t.iconPath = new vscode.ThemeIcon('git-merge');
        t.contextValue = 'edgeGroup';
        t.description = hiddenCount ? `${m.edges.length - hiddenCount} of ${m.edges.length} visible` : `${m.edges.length}`;
        t.checkboxState = check(m.edges.every(e => this.state.hidden.has(edgeKey(e.key))));
        return t;
      }
      case 'edge': {
        const e = m.edges.find(x => x.key === i.key)!;
        const t = new vscode.TreeItem(`${label(e.from)} → ${label(e.to)}`);
        t.id = edgeKey(e.key);
        t.iconPath = new vscode.ThemeIcon('arrow-right');
        t.contextValue = 'edge';
        t.checkboxState = check(this.state.hidden.has(edgeKey(e.key)));
        const own = this.state.hidden.has(edgeKey(e.key));
        const viaBlock = !own && isSequence(m) ? blockSuppressor(m, this.state.hidden, m.edgeParent[e.index]) : undefined;
        const viaNode = !own && !viaBlock && vis.isEdgeHidden(e);
        const blockNote = viaBlock ? (this.state.hidden.has(subgraphKey(viaBlock.id)) ? 'hidden by block' : 'collapsed in diagram') : '';
        t.description = [e.label, blockNote, viaNode ? `hidden by ${words.node}` : ''].filter(Boolean).join(' · ');
        return t;
      }
      case 'participants': {
        const t = new vscode.TreeItem('Participants', COLLAPSIBLE[initialState(i)]);
        t.id = 'participants';
        t.iconPath = new vscode.ThemeIcon('organization');
        t.contextValue = 'participants';
        t.description = `${m.nodes.size}`;
        return t;
      }
      case 'block': {
        const sm = m as SequenceModel;
        const b = sm.blocks.get(i.id)!;
        // Huvudgrenen (gren 0) har samma typ och titel som blocket; visa bara titeln.
        const main = b.section && i.id.endsWith(':0');
        const text = main ? b.title || 'main branch' : b.title ? `${b.kind} ${b.title}` : b.kind;
        const t = new vscode.TreeItem(text, COLLAPSIBLE[initialState(i)]);
        t.id = `block:${i.id}`;
        t.tooltip = `${b.kind} – line ${b.line + 1}`;
        const collapsed = this.state.hidden.has(collapseKey(i.id));
        const own = this.state.hidden.has(subgraphKey(i.id));
        const outer = !own && b.parent ? blockSuppressor(sm, this.state.hidden, b.parent) : undefined;
        // En gren (else, and, option) kan fällas ihop men inte döljas; den följer sitt block.
        if (b.section) {
          t.iconPath = new vscode.ThemeIcon('debug-step-over');
          t.contextValue = collapsed ? 'sectionCollapsed' : 'section';
          t.description = outer ? (this.state.hidden.has(subgraphKey(outer.id)) ? 'hidden by block' : 'inside collapsed block')
            : collapsed ? 'collapsed in diagram' : '';
          return t;
        }
        t.iconPath = new vscode.ThemeIcon(BLOCK_ICONS[b.kind] ?? 'symbol-structure');
        // Eget kontextvärde: block kan fällas ihop och döljas men inte byta namn.
        t.contextValue = collapsed ? 'blockCollapsed' : 'block';
        t.checkboxState = check(own);
        t.description = outer ? (this.state.hidden.has(subgraphKey(outer.id)) ? 'hidden by block' : 'inside collapsed block')
          : collapsed && !own ? 'collapsed in diagram' : '';
        return t;
      }
    }
  }

  refresh() { this.changed.fire(undefined); }
}

// ---------------------------------------------------------------- förhandsvisning

class Preview {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  /** Filen som förhandsvisningen senast fick. */
  private shown: string | undefined;
  /** Det som ska markeras så snart diagrammet har ritats. */
  private pendingShow: object | undefined;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly state: DiagramState,
    private readonly onClicked: (kind: 'node' | 'subgraph' | 'block', id: string, toggle: boolean, branch: boolean) => void,
    private readonly onEdgeClicked: (texts: string[], index: number) => void,
  ) {
    state.onDidChange(() => this.update());
  }

  open() {
    if (this.panel) { this.panel.reveal(vscode.ViewColumn.Beside, true); return; }
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
    const mermaidDist = vscode.Uri.joinPath(this.ctx.extensionUri, 'node_modules', 'mermaid', 'dist');
    this.panel = vscode.window.createWebviewPanel('mermaidTree.preview', 'Mermaid Preview',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media, mermaidDist] });
    this.ready = false;
    this.panel.webview.html = this.html(this.panel.webview, media, mermaidDist);
    this.panel.onDidDispose(() => { this.panel = undefined; this.pendingShow = undefined; this.shown = undefined; });
    this.panel.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'ready') { this.ready = true; this.update(); }
      if (msg.type === 'rendered' && this.pendingShow) {
        void this.panel?.webview.postMessage(this.pendingShow);
        this.pendingShow = undefined;
      }
      if (msg.type === 'clicked') this.onClicked(msg.kind, msg.id, msg.toggle === true, msg.branch === true);
      if (msg.type === 'edgeClicked' && Array.isArray(msg.texts)) this.onEdgeClicked(msg.texts.map(String), Number(msg.index));
      if (msg.type === 'export') void this.save(msg.format, msg.data);
      if (msg.type === 'exportFailed') void vscode.window.showErrorMessage(`Could not export the diagram: ${msg.message}`);
    });
  }

  /** Sparar exporten bredvid diagramfilen, med samma namn som förslag. */
  private async save(format: 'svg' | 'png', data: string) {
    const doc = this.state.doc;
    if (!doc) return;
    const name = doc.uri.path.replace(/.[^./]+$/, '') + '.' + format;
    const target = await vscode.window.showSaveDialog({
      title: `Export Diagram as ${format.toUpperCase()}`,
      // En osparad fil har ingen mapp att föreslå.
      defaultUri: doc.uri.scheme === 'file' ? doc.uri.with({ path: name }) : undefined,
      filters: format === 'svg' ? { 'SVG image': ['svg'] } : { 'PNG image': ['png'] },
    });
    if (!target) return;
    const bytes = format === 'svg' ? Buffer.from(data, 'utf8') : Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
    await vscode.workspace.fs.writeFile(target, bytes);
    void vscode.window.setStatusBarMessage(`Saved ${vscode.workspace.asRelativePath(target)}`, 4000);
  }

  focus(kind: 'node' | 'subgraph' | 'block', id: string) {
    if (this.ready) void this.panel?.webview.postMessage({ type: 'focus', kind, id });
  }

  /** Öppnar förhandsvisningen och markerar elementet, när diagrammet som ska visas är ritat. */
  show(shown: Exclude<Shown, { hidden: string }>) {
    this.open();
    const msg = shown.kind === 'edgeText' ? { ...shown, type: 'focusEdge' } : { type: 'focus', kind: shown.kind, id: shown.id };
    if (this.ready && this.shown === this.state.doc?.uri.toString()) void this.panel?.webview.postMessage(msg);
    else this.pendingShow = msg;
  }

  /** Inget i bilden är valt längre. */
  clearSelection() {
    if (this.ready) void this.panel?.webview.postMessage({ type: 'clearSelection' });
  }

  update() {
    if (!this.panel || !this.ready || !this.state.doc) return;
    const docUri = this.state.doc.uri;
    this.panel.title = `Preview: ${docUri.scheme === COMBINED_SCHEME ? docUri.path.slice(1) : vscode.workspace.asRelativePath(docUri)}`;
    const cfg = vscode.workspace.getConfiguration('mermaidTree.preview');
    const theme = { theme: cfg.get<string>('theme', 'auto'), themeVariables: cfg.get<Record<string, unknown>>('themeVariables', {}) };
    // En annan fil än förra gången: visa hela diagrammet (Fit) i stället för att behålla zoomen.
    const uri = this.state.doc.uri.toString();
    const fit = uri !== this.shown;
    this.shown = uri;
    void this.panel.webview.postMessage({ type: 'render', ...this.state.rendered(), ...theme, fit });
  }

  private html(webview: vscode.Webview, media: vscode.Uri, mermaidDist: vscode.Uri): string {
    const nonce = [...Array(32)].map(() => Math.random().toString(36)[2]).join('');
    const uri = (base: vscode.Uri, file: string) => webview.asWebviewUri(vscode.Uri.joinPath(base, file));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri(media, 'preview.css')}">
</head>
<body>
${TOOLBAR_HTML}
<div id="stage"></div>
<pre id="error" hidden></pre>
<script nonce="${nonce}" src="${uri(mermaidDist, 'mermaid.min.js')}"></script>
<script nonce="${nonce}" src="${uri(media, 'zoom.js')}"></script>
<script nonce="${nonce}" src="${uri(media, 'labels.js')}"></script>
<script nonce="${nonce}" src="${uri(media, 'export.js')}"></script>
<script nonce="${nonce}" src="${uri(media, 'preview.js')}"></script>
</body>
</html>`;
  }
}

const TOOLBAR_HTML = `<div id="toolbar">
  <button data-action="out" title="Zoom out (-)">−</button>
  <button data-action="in" title="Zoom in (+)">+</button>
  <button data-action="fit" title="Fit to window (0)">Fit</button>
  <button data-action="width" title="Fit width (w)">Width</button>
  <button data-action="actual" title="Actual size (1)">100%</button>
  <button data-action="selection" title="Zoom to selection">Selection</button>
  <span class="sep"></span>
  <label for="layout">Layout</label>
  <select id="layout">
    <option value="">default</option>
    <option>dagre</option>
    <option>elk</option>
    <option>elk.stress</option>
    <option>elk.force</option>
    <option>elk.mrtree</option>
  </select>
  <label for="look">Look</label>
  <select id="look">
    <option value="">default</option>
    <option>neo</option>
    <option>classic</option>
    <option>handDrawn</option>
  </select>
  <label for="theme">Theme</label>
  <select id="theme" title="Try a Mermaid theme. The setting Mermaid Tree › Preview: Theme decides which one is used from the start.">
    <option>auto</option>
    <option>default</option>
    <option>dark</option>
    <option>forest</option>
    <option>neutral</option>
    <option>base</option>
    <option>neo</option>
    <option>neo-dark</option>
    <option>redux</option>
    <option>redux-dark</option>
    <option>redux-color</option>
    <option>redux-dark-color</option>
  </select>
  <span class="sep"></span>
  <button data-action="svg" title="Save the whole diagram as SVG">SVG</button>
  <button data-action="png" title="Save the whole diagram as PNG (2×)">PNG</button>
  <span id="zoom-level"></span>
</div>`;

// ---------------------------------------------------------------- aktivering

export function activate(ctx: vscode.ExtensionContext) {
  const state = new DiagramState(ctx);
  const tree = new StructureProvider(state);
  const view = vscode.window.createTreeView('mermaidTree.structure', {
    treeDataProvider: tree, manageCheckboxStateManually: true, showCollapseAll: true,
  });

  const combined = new CombinedViews();

  /** Från en sammanslagen vy: visa raden i filen den kommer från, i samma editorgrupp som vyn. */
  const revealSource = async (src: { file: vscode.Uri; line: number }, column: vscode.ViewColumn | undefined) => {
    const doc = await vscode.workspace.openTextDocument(src.file);
    const editor = await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: true, viewColumn: column ?? vscode.ViewColumn.One });
    const range = doc.lineAt(src.line).range;
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  };

  const revealLine = (line: number) => {
    const editor = vscode.window.visibleTextEditors.find(e => e.document === state.doc);
    if (state.doc?.uri.scheme === COMBINED_SCHEME) {
      const src = combined.source(state.doc.uri, line);
      const files = vscode.window.visibleTextEditors.find(e => state.doc && combined.includes(state.doc.uri, e.document.uri));
      if (src) void revealSource(src, (editor ?? files)?.viewColumn);
      return;
    }
    if (!editor) return;
    const range = editor.document.lineAt(line).range;
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  };

  /** Pilen vars text just klickades i bilden, medan trädet väljer den. */
  let edgeFromPreview: string | undefined;

  const preview = new Preview(ctx, state, (clickedKind, clickedId, toggle, branch) => {
    // Klick på blockets titel gäller huvudgrenen när blocket har fler grenar.
    const m0 = state.model;
    const id = branch && m0 && isSequence(m0) && m0.blocks.has(`${clickedId}:0`) ? `${clickedId}:0` : clickedId;
    if (clickedKind === 'block') {
      // Klick på blockets etikett eller på anteckningen i ett hopfällt block fäller ihop eller ut.
      const m = state.model;
      if (!m || !isSequence(m) || !m.blocks.has(id)) return;
      if (toggle) state.setCollapsed(id, !state.hidden.has(collapseKey(id)));
      const item = tree.find('block', id);
      if (item) void view.reveal(item, { select: true, focus: false });
      revealLine(m.blocks.get(id)!.line);
      return;
    }
    // En hopfälld grupp ritas som en nod med gruppens id.
    const kind = clickedKind === 'node' && !state.model?.nodes.has(id) && state.model?.subgraphs.has(id) ? 'subgraph' : clickedKind;
    const item = tree.find(kind, id);
    if (item) void view.reveal(item, { select: true, focus: false });
    const m = state.model;
    const line = kind === 'node' ? m?.nodes.get(id)?.line : m?.subgraphs.get(id)?.line;
    if (line !== undefined) revealLine(line);
  }, (texts, index) => {
    // Klick på en pils text: kanten i trädet och dess rad i koden.
    const m = state.model;
    const edge = m && edgeAtClick(m, state.hidden, texts, index);
    if (!edge) return;
    edgeFromPreview = edge.key;
    void view.reveal(tree.item({ kind: 'edge', key: edge.key }), { select: true, focus: false });
    revealLine(edge.line);
  });

  const NAMING = 'naming';
  const LOOKALIKE = 'lookalike';
  const SIMILAR = 'similar';
  /** Om en kontroll av namn är påslagen i inställningarna. */
  const check = (name: string) => vscode.workspace.getConfiguration('mermaidTree.checks').get<boolean>(name, true);
  const FIX_ALL = vscode.CodeActionKind.SourceFixAll.append('mermaidTree');
  const namingStyle = () => vscode.workspace.getConfiguration('mermaidTree').get<NamingStyle>('namingStyle', 'off');

  // Fel i editorn: Mermaids syntaxfel, id:n som bara skiljer i stora/små bokstäver och namn som bryter mot stilen.
  const diagnostics = vscode.languages.createDiagnosticCollection('mermaidTree');
  const toDiagnostic = (c: { line: number; start: number; end: number; message: string }, source: string) => {
    const d = new vscode.Diagnostic(new vscode.Range(c.line, c.start, c.line, c.end), c.message, vscode.DiagnosticSeverity.Error);
    d.source = source;
    return d;
  };
  const updateDiagnostics = async () => {
    const doc = state.doc;
    const m = state.model;
    if (!doc || !m) return;
    const version = doc.version;
    const text = doc.getText();
    const found = (check('letterCase') ? caseConflicts(text, m) : []).map(c => toDiagnostic(c, 'Mermaid Tree'));
    if (check('similarNames')) {
      for (const issue of similarNames(text, m, namingStyle())) {
        const d = toDiagnostic(issue, 'Mermaid Tree');
        d.severity = vscode.DiagnosticSeverity.Warning;
        d.code = SIMILAR;
        found.push(d);
      }
    }
    for (const issue of namingIssues(text, m, namingStyle())) {
      const d = toDiagnostic(issue, 'Mermaid Tree');
      d.severity = vscode.DiagnosticSeverity.Warning;
      d.code = NAMING;
      found.push(d);
    }
    for (const issue of check('lookalikeLetters') ? lookalikeIssues(text, m) : []) {
      for (const r of issue.ranges) {
        const d = toDiagnostic({ ...r, message: issue.message }, 'Mermaid Tree');
        d.severity = vscode.DiagnosticSeverity.Warning;
        d.code = LOOKALIKE;
        found.push(d);
      }
    }
    // Krockar mellan filerna i en sammanslagen vy.
    for (const c of combined.conflicts(doc.uri)) {
      const line = doc.lineAt(c.line);
      const d = toDiagnostic({ line: c.line, start: line.firstNonWhitespaceCharacterIndex, end: line.text.length, message: c.message }, 'Mermaid Tree');
      d.severity = vscode.DiagnosticSeverity.Warning;
      found.push(d);
    }
    let err = null;
    try { err = await checkSyntax(text); } catch { /* Mermaid kunde inte laddas; visa bara våra egna fel */ }
    // En nyare version av texten hann komma medan Mermaid tolkade; den uppdaterar själv.
    if (doc !== state.doc || doc.version !== version) return;
    const syntax = err && syntaxDiagnostic(err, text);
    diagnostics.set(doc.uri, syntax ? [toDiagnostic(syntax, 'Mermaid'), ...found] : found);
  };
  state.onDidChange(() => void updateDiagnostics());
  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('mermaidTree.namingStyle') || e.affectsConfiguration('mermaidTree.checks')) void updateDiagnostics();
    if (e.affectsConfiguration('mermaidTree.preview')) preview.update();
  }));
  // Diagramtypen visas bredvid panelens namn i stället för som en egen rotnod.
  state.onDidChange(() => { view.description = state.model?.diagramType || undefined; });
  // Change Participant visas bara i sequence diagram.
  state.onDidChange(() => void vscode.commands.executeCommand('setContext', 'mermaidTree.sequence', state.model?.diagramType === 'sequenceDiagram'));
  // Combine Class Diagrams visas i högerklicksmenyn bara i klassdiagram.
  state.onDidChange(() => void vscode.commands.executeCommand('setContext', 'mermaidTree.classDiagram', /^classDiagram/.test(state.model?.diagramType ?? '')));

  // Sökning i trädet: filtrerar medan man skriver. Filtret ligger kvar när rutan stängs (även när man
  // klickar i trädet) och tas bort med Clear Search eller en tom sökning.
  const showSearch = () => {
    const m = state.model;
    const q = tree.query;
    void vscode.commands.executeCommand('setContext', 'mermaidTree.searching', q !== '');
    if (!q || !m) { view.message = undefined; return; }
    const n = countMatches(m, q);
    view.message = n ? `${n} ${n === 1 ? 'match' : 'matches'} for "${q}"` : `No matches for "${q}"`;
  };
  const search = (query: string) => { tree.setQuery(query); showSearch(); };
  state.onDidChange(showSearch);

  const track = (editor: vscode.TextEditor | undefined) => {
    if (!editor || !isMermaid(editor.document)) return;
    // Ett klick i en sammanslagen vy öppnar källfilen; vyn ska ligga kvar i trädet och förhandsvisningen.
    if (state.doc && combined.includes(state.doc.uri, editor.document.uri)) return;
    state.setDocument(editor.document);
  };
  track(vscode.window.activeTextEditor);

  let timer: ReturnType<typeof setTimeout> | undefined;

  ctx.subscriptions.push(
    view,
    diagnostics,
    vscode.workspace.onDidCloseTextDocument(doc => diagnostics.delete(doc.uri)),
    // En fil räknas som stängd när ingen flik visar den längre (dokumentet kan leva kvar en stund).
    vscode.window.tabGroups.onDidChangeTabs(e => {
      const uriOf = (t: vscode.Tab) => t.input instanceof vscode.TabInputText ? t.input.uri.toString() : undefined;
      const open = new Set(vscode.window.tabGroups.all.flatMap(g => g.tabs.map(uriOf)));
      for (const t of e.closed) {
        const uri = uriOf(t);
        if (!uri || open.has(uri)) continue;
        const closed = vscode.Uri.parse(uri);
        state.closed(closed);
        // Den sammanslagna vyn är stängd: en källfil får visas för sig själv igen.
        if (closed.scheme === COMBINED_SCHEME) { combined.closed(closed); track(vscode.window.activeTextEditor); }
      }
    }),
    vscode.workspace.registerTextDocumentContentProvider(COMBINED_SCHEME, combined),
    vscode.workspace.onDidChangeTextDocument(e => combined.sourceChanged(e.document.uri)),
    // Filer som ändras utanför VS Code (till exempel git pull).
    (() => {
      const watcher = vscode.workspace.createFileSystemWatcher('**/*.{mmd,mermaid}');
      watcher.onDidChange(uri => combined.sourceChanged(uri));
      return watcher;
    })(),
    vscode.window.onDidChangeActiveTextEditor(track),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document !== state.doc) return;
      clearTimeout(timer);
      timer = setTimeout(() => state.reparse(), 200);
    }),

    view.onDidChangeCheckboxState(e => {
      const m = state.model;
      if (!m) return;
      for (const [item, checked] of e.items) {
        const visible = checked === vscode.TreeItemCheckboxState.Checked;
        if (item.kind === 'edgeGroup') state.setVisible(m.edges.map(x => edgeKey(x.key)), visible);
        else if (item.kind !== 'info' && item.kind !== 'participants') state.setVisible([itemKey(item)], visible);
      }
    }),

    view.onDidChangeSelection(e => {
      const item = e.selection[0];
      const m = state.model;
      const fromPreview = edgeFromPreview;
      edgeFromPreview = undefined;
      if (!item || !m) return;
      if (item.kind === 'node') { revealLine(m.nodes.get(item.id)!.line); preview.focus('node', item.id); }
      if (item.kind === 'subgraph') { revealLine(m.subgraphs.get(item.id)!.line); preview.focus('subgraph', item.id); }
      if (item.kind === 'edge') {
        revealLine(m.edges.find((x: FlowEdge) => x.key === item.key)!.line);
        // Valdes pilen i trädet lyser inget i bilden; klickades dess text i bilden är den texten markerad.
        if (item.key !== fromPreview) preview.clearSelection();
      }
      if (item.kind === 'block' && isSequence(m)) {
        const b = m.blocks.get(item.id)!;
        revealLine(b.line);
        preview.focus('block', b.section ? b.parent! : item.id);
      }
    }),

    vscode.commands.registerCommand('mermaidTree.openPreview', (uri?: vscode.Uri) => {
      const doc = uri ? vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString()) : vscode.window.activeTextEditor?.document;
      if (doc && isMermaid(doc)) state.setDocument(doc);
      if (!state.doc) { void vscode.window.showInformationMessage('Open a .mmd or .mermaid file first.'); return; }
      preview.open();
    }),

    vscode.commands.registerCommand('mermaidTree.showTree', async (uri?: vscode.Uri) => {
      const doc = uri ? vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString()) : vscode.window.activeTextEditor?.document;
      if (doc && isMermaid(doc)) state.setDocument(doc);
      await vscode.commands.executeCommand('mermaidTree.structure.focus');
    }),

    vscode.commands.registerCommand('mermaidTree.showAll', () => state.replaceHidden([])),

    vscode.commands.registerCommand('mermaidTree.search', () => {
      const box = vscode.window.createInputBox();
      box.title = 'Search Tree';
      box.placeholder = 'Name, id, label, message or block title';
      box.value = tree.query;
      box.onDidChangeValue(search);
      box.onDidAccept(() => box.hide());
      box.onDidHide(() => box.dispose());
      box.show();
    }),

    vscode.commands.registerCommand('mermaidTree.clearSearch', () => search('')),

    vscode.commands.registerCommand('mermaidTree.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${ctx.extension.id}`)),

    vscode.commands.registerCommand('mermaidTree.focusNeighbors', (item?: Item) => {
      const m = state.model;
      const target = item ?? view.selection[0];
      if (!m || target?.kind !== 'node') return;
      const keep = neighborhood(m, target.id, 1);
      state.replaceHidden([...m.nodes.keys()].filter(id => !keep.has(id)).map(nodeKey));
      preview.focus('node', target.id);
    }),

    vscode.commands.registerCommand('mermaidTree.hideItem', (item?: Item) => {
      if (item && item.kind !== 'info' && item.kind !== 'edgeGroup' && item.kind !== 'participants') state.setVisible([itemKey(item)], false);
    }),

    vscode.commands.registerCommand('mermaidTree.collapseGroup', (item?: Item) => {
      const target = item ?? view.selection[0];
      if (target?.kind === 'subgraph' || target?.kind === 'block') { state.setCollapsed(target.id, true); preview.focus(target.kind, target.id); }
    }),

    vscode.commands.registerCommand('mermaidTree.expandGroup', (item?: Item) => {
      const target = item ?? view.selection[0];
      if (target?.kind === 'subgraph' || target?.kind === 'block') { state.setCollapsed(target.id, false); preview.focus(target.kind, target.id); }
    }),

    // Visa och markera elementet på raden i koden, eller det valda i trädet, i förhandsvisningen.
    vscode.commands.registerCommand('mermaidTree.showInDiagram', (arg?: Item | vscode.Uri) => {
      const item = arg && !(arg instanceof vscode.Uri) ? arg : undefined;
      let target: Target | undefined;
      if (item) {
        const m = state.model;
        if (item.kind === 'node') target = { kind: 'node', id: item.id };
        else if (item.kind === 'subgraph') target = { kind: 'subgraph', id: item.id };
        else if (item.kind === 'block' && m && isSequence(m)) {
          const b = m.blocks.get(item.id)!;
          target = { kind: 'block', id: b.section ? b.parent! : item.id };
        } else if (item.kind === 'edge' && m) {
          const edge = m.edges.find((x: FlowEdge) => x.key === item.key);
          if (edge) target = { kind: 'edge', edge };
        }
      } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isMermaid(editor.document)) return;
        const doc = editor.document;
        const inCombined = state.doc !== undefined && combined.includes(state.doc.uri, doc.uri);
        if (!inCombined) state.setDocument(doc);
        const pos = editor.selection.active;
        const found = targetAt(doc.getText(), parseDiagram(doc.getText()), pos.line, pos.character);
        // I en källfil till en sammanslagen vy: samma pil i den sammanslagna modellen.
        target = found?.kind === 'edge' && inCombined
          ? (() => {
            const edge = state.model?.edges.find((e: FlowEdge) => e.from === found.edge.from && e.to === found.edge.to && e.label === found.edge.label);
            return edge ? { kind: 'edge' as const, edge } : undefined;
          })()
          : found;
      }
      if (!target || !state.model) {
        void vscode.window.setStatusBarMessage('Nothing to show in the diagram here', 4000);
        return;
      }
      const shown = resolveTarget(state.model, state.hidden, target);
      if ('hidden' in shown) {
        preview.clearSelection();
        void vscode.window.showInformationMessage(`"${shown.hidden}" is hidden in the diagram.`);
        return;
      }
      preview.show(shown);
    }),

    // Välj klassdiagram i arbetsytan och rita dem tillsammans.
    vscode.commands.registerCommand('mermaidTree.combineClassDiagrams', async () => {
      const found = await vscode.workspace.findFiles('**/*.{mmd,mermaid}', '**/node_modules/**', 1000);
      const uris = new Map(found.map(u => [u.toString(), u]));
      for (const d of vscode.workspace.textDocuments) if (d.uri.scheme === 'file' && isMermaid(d)) uris.set(d.uri.toString(), d.uri);
      const classes: vscode.Uri[] = [];
      for (const uri of uris.values()) {
        const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
        const text = open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        if (/^classDiagram/.test(parseDiagram(text).diagramType)) classes.push(uri);
      }
      if (classes.length < 2) {
        void vscode.window.showInformationMessage('Combining needs at least two class diagrams in this workspace.');
        return;
      }
      const active = vscode.window.activeTextEditor?.document.uri.toString();
      const items = classes
        .map(uri => ({ label: vscode.workspace.asRelativePath(uri), picked: uri.toString() === active, uri }))
        .sort((a, b) => a.label.localeCompare(b.label));
      const picked = await vscode.window.showQuickPick(items, { canPickMany: true, title: 'Combine Class Diagrams', placeHolder: 'Choose the class diagrams to draw together' });
      if (!picked) return;
      if (picked.length < 2) {
        void vscode.window.showInformationMessage('Choose at least two class diagrams to combine.');
        return;
      }
      const doc = await vscode.workspace.openTextDocument(CombinedViews.uriFor(picked.map(p => p.uri)));
      await vscode.window.showTextDocument(doc, { preview: false });
      await vscode.commands.executeCommand('mermaidTree.openPreview', doc.uri);
    }),

    // Byt namn (F2 och Rename Symbol i editorns högerklicksmeny).
    vscode.languages.registerRenameProvider({ language: 'mermaid' }, {
      prepareRename(doc, pos) {
        if (doc.uri.scheme === COMBINED_SCHEME) throw new Error(READ_ONLY);
        const hit = idAt(doc.getText(), parseDiagram(doc.getText()), pos.line, pos.character);
        if (!hit) throw new Error('Place the cursor on the name of a node, state, participant, class or group to rename it.');
        const range = new vscode.Range(hit.line, hit.start, hit.line, hit.end);
        return { range, placeholder: doc.getText(range) };
      },
      provideRenameEdits(doc, pos, newName) {
        const text = doc.getText();
        const m = parseDiagram(text);
        const hit = idAt(text, m, pos.line, pos.character);
        return hit ? renameEdit(doc, m, hit.id, newName) : undefined;
      },
    }),

    // Snabbfix för namngivningsregeln: byt namn på ett id, eller på alla i filen. Körs som kommando,
    // så att dolt och hopfällt flyttas till de nya namnen först när man faktiskt väljer fixen.
    vscode.languages.registerCodeActionsProvider({ language: 'mermaid' }, {
      provideCodeActions(doc, _range, context) {
        if (doc.uri.scheme === COMBINED_SCHEME) return [];
        const style = namingStyle();
        // Rätta allt, till exempel vid sparning med editor.codeActionsOnSave.
        if (context.only && FIX_ALL.intersects(context.only)) {
          if (style === 'off') return [];
          const a = new vscode.CodeAction(`Rename all names in this file to ${style}`, FIX_ALL);
          a.command = { title: a.title, command: 'mermaidTree.fixNaming', arguments: [doc.uri] };
          return [a];
        }
        const text = doc.getText();
        const actions: vscode.CodeAction[] = [];
        // Tecken som ser latinska ut: byt till latinska bokstäver överallt där namnet används.
        const lookalikes = context.diagnostics.filter(d => d.code === LOOKALIKE);
        if (lookalikes.length) {
          for (const issue of lookalikeIssues(text, parseDiagram(text))) {
            const ds = lookalikes.filter(d => issue.ranges.some(r => r.line === d.range.start.line && r.start === d.range.start.character));
            if (!ds.length || !issue.fixable) continue;
            const a = new vscode.CodeAction(issue.merges
              ? `Use Latin letters: "${issue.name}" → "${issue.suggestion}" (the existing name)`
              : `Use Latin letters: "${issue.name}" → "${issue.suggestion}"`, vscode.CodeActionKind.QuickFix);
            a.diagnostics = ds;
            a.isPreferred = true;
            a.command = { title: a.title, command: 'mermaidTree.fixLookalike', arguments: [doc.uri, issue.id] };
            actions.push(a);
          }
        }
        // Namn som bara skiljer sig i ordindelning: använd det andra namnet överallt, så blir de ett.
        const similar = context.diagnostics.filter(d => d.code === SIMILAR);
        if (similar.length) {
          const found = similarNames(text, parseDiagram(text), style);
          for (const d of similar) {
            const issue = found.find(i => i.line === d.range.start.line && i.start === d.range.start.character);
            for (const other of issue?.similar ?? []) {
              const a = new vscode.CodeAction(`Use "${other}" instead of "${issue!.id}"`, vscode.CodeActionKind.QuickFix);
              a.diagnostics = [d];
              a.command = { title: a.title, command: 'mermaidTree.useName', arguments: [doc.uri, issue!.id, other] };
              actions.push(a);
            }
          }
        }
        const ours = context.diagnostics.filter(d => d.code === NAMING);
        if (!ours.length) return actions;
        const issues = namingIssues(text, parseDiagram(text), style);
        for (const d of ours) {
          const issue = issues.find(i => i.line === d.range.start.line && i.start === d.range.start.character);
          if (!issue?.fixable) continue;
          const a = new vscode.CodeAction(`Rename "${issue.name}" to "${issue.suggestion}"`, vscode.CodeActionKind.QuickFix);
          a.diagnostics = [d];
          a.isPreferred = true;
          a.command = { title: a.title, command: 'mermaidTree.fixNaming', arguments: [doc.uri, issue.id, issue.suggestion] };
          actions.push(a);
        }
        if (issues.filter(i => i.fixable).length > 1) {
          const all = new vscode.CodeAction(`Rename all names in this file to ${style}`, vscode.CodeActionKind.QuickFix);
          // Utan kopplade varningar visas den inte i hover-rutan, bara med Ctrl+.
          all.diagnostics = ours;
          all.command = { title: all.title, command: 'mermaidTree.fixNaming', arguments: [doc.uri] };
          actions.push(all);
        }
        return actions;
      },
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, FIX_ALL] }),

    vscode.commands.registerCommand('mermaidTree.fixNaming', async (uri: vscode.Uri, id?: string, newName?: string) => {
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      if (!doc) return;
      try {
        if (id !== undefined && newName !== undefined) {
          await vscode.workspace.applyEdit(renameEdit(doc, parseDiagram(doc.getText()), id, newName));
          return;
        }
        await fixAllNaming(doc);
      } catch (e) {
        void vscode.window.showErrorMessage(String((e as Error).message));
      }
    }),

    // Använd ett annat befintligt namn överallt, så att de två blir ett.
    vscode.commands.registerCommand('mermaidTree.useName', async (uri: vscode.Uri, id: string, other: string) => {
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      if (!doc) return;
      const edit = new vscode.WorkspaceEdit();
      for (const r of occurrences(doc.getText(), parseDiagram(doc.getText()), id)) edit.replace(doc.uri, new vscode.Range(r.line, r.start, r.line, r.end), other);
      if (await vscode.workspace.applyEdit(edit) && state.doc === doc) state.renameKeys(id, other);
    }),

    // Byt tecken som ser latinska ut mot latinska bokstäver; ett namn som ser ut som ett annat slås ihop med det.
    vscode.commands.registerCommand('mermaidTree.fixLookalike', async (uri: vscode.Uri, id: string) => {
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      if (!doc) return;
      const m = parseDiagram(doc.getText());
      const issue = lookalikeIssues(doc.getText(), m).find(i => i.id === id);
      if (!issue?.fixable) return;
      const edit = new vscode.WorkspaceEdit();
      for (const r of issue.ranges) edit.replace(doc.uri, new vscode.Range(r.line, r.start, r.line, r.end), issue.suggestion);
      if (!await vscode.workspace.applyEdit(edit)) return;
      if (state.doc === doc) state.renameKeys(id, renamedId(m, id, issue.suggestion));
    }),

    // Rätta alla namn i filen från kommandopaletten eller editorns högerklicksmeny.
    vscode.commands.registerCommand('mermaidTree.fixAllNaming', async (uri?: vscode.Uri) => {
      const doc = uri ? vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString()) : vscode.window.activeTextEditor?.document;
      if (!doc) return;
      if (namingStyle() === 'off') {
        const open = 'Open Settings';
        if (await vscode.window.showInformationMessage('Choose a naming style first (Mermaid Tree: Naming Style).', open) === open) {
          await vscode.commands.executeCommand('mermaidTree.openSettings');
        }
        return;
      }
      const n = await fixAllNaming(doc);
      void vscode.window.setStatusBarMessage(n ? `Renamed ${n} name${n === 1 ? '' : 's'} to ${namingStyle()}` : 'All names already follow the naming style', 4000);
    }),

    // Semantisk färgläggning: namnen färgas efter vad parsern vet att de är.
    vscode.languages.registerDocumentSemanticTokensProvider({ language: 'mermaid' }, {
      provideDocumentSemanticTokens(doc) {
        const text = doc.getText();
        const builder = new vscode.SemanticTokensBuilder(SEMANTIC_LEGEND);
        for (const t of semanticTokens(text, parseDiagram(text))) builder.push(t.line, t.start, t.length, LEGEND.tokenTypes.indexOf(t.type), t.modifiers.length ? 1 : 0);
        return builder.build();
      },
    }, SEMANTIC_LEGEND),

    // Förslag på deltagare när man skriver i ett sequence diagram.
    vscode.languages.registerCompletionItemProvider({ language: 'mermaid' }, {
      provideCompletionItems(doc, pos, _token, context) {
        const text = doc.getText();
        const r = participantCompletion(text, parseDiagram(text), pos.line, pos.character);
        if (!r) return undefined;
        // Ett mellanslag i början av raden är indrag, inte början på ett meddelande.
        const before = doc.lineAt(pos.line).text.slice(0, r.start);
        if (context.triggerCharacter === ' ' && /^\s*$/.test(before)) return undefined;
        const range = new vscode.Range(pos.line, r.start, pos.line, pos.character);
        return r.items.map((p, i) => {
          const item = new vscode.CompletionItem({ label: p.id, description: p.label !== p.id ? p.label : undefined }, vscode.CompletionItemKind.Variable);
          item.range = range;
          item.sortText = String(i).padStart(4, '0');
          item.detail = 'Participant';
          return item;
        });
      },
    }, '>', '+', ' ', ','),

    // Byt en enda förekomst av en deltagare mot en annan (Rename byter alla).
    vscode.commands.registerCommand('mermaidTree.changeParticipant', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const doc = editor.document;
      const text = doc.getText();
      const m = parseDiagram(text);
      const pos = editor.selection.active;
      const hit = participantAt(text, m, pos.line, pos.character);
      if (!hit) {
        void vscode.window.showInformationMessage('Place the cursor on a participant in a message, note or activate line. To rename a participant everywhere, use Rename (F2).');
        return;
      }
      if (hit.blocked) {
        void vscode.window.showInformationMessage(hit.blocked);
        return;
      }
      const choices = participantChoices(m, hit.id);
      if (!choices.length) {
        void vscode.window.showInformationMessage('There is no other participant to change to.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        choices.map(c => ({ label: c.id, description: c.label !== c.id ? c.label : undefined })),
        { title: `Change "${hit.id}" to`, placeHolder: 'Participant' });
      if (!picked || doc.version !== editor.document.version) return;
      const range = new vscode.Range(hit.line, hit.start, hit.line, hit.end);
      await editor.edit(b => b.replace(range, picked.label));
    }),

    // Byt namn från trädets högerklicksmeny.
    vscode.commands.registerCommand('mermaidTree.renameItem', async (item?: Item) => {
      const target = item ?? view.selection[0];
      const doc = state.doc;
      const m = doc && parseDiagram(doc.getText());
      if (!doc || !m || (target?.kind !== 'node' && target?.kind !== 'subgraph')) return;
      // En namespace visar och byter bara sitt sista segment.
      const current = /^classDiagram/.test(m.diagramType) && m.subgraphs.has(target.id) ? target.id.slice(target.id.lastIndexOf('.') + 1) : target.id;
      const newName = await vscode.window.showInputBox({
        title: `Rename "${current}"`,
        prompt: 'New name. Labels, messages and comments are not changed.',
        value: current,
        validateInput: v => v === current ? undefined : rename(doc.getText(), m, target.id, v).error,
      });
      if (newName === undefined || newName === current) return;
      try {
        await vscode.workspace.applyEdit(renameEdit(doc, parseDiagram(doc.getText()), target.id, newName));
      } catch (e) {
        void vscode.window.showErrorMessage(String((e as Error).message));
      }
    }),
  );

  /** Byter alla namn i filen som går att rätta till vald stil, som ett steg att ångra. Ger antalet. */
  async function fixAllNaming(doc: vscode.TextDocument): Promise<number> {
    const r = fixAll(doc.getText(), namingStyle());
    if (!r.renamed.length) return 0;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), r.text);
    if (!await vscode.workspace.applyEdit(edit)) return 0;
    if (state.doc === doc) for (const [oldId, newId] of r.renamed) state.renameKeys(oldId, newId);
    return r.renamed.length;
  }

  /** Ändringarna för ett namnbyte. Det som är dolt och hopfällt följer med till det nya namnet. */
  function renameEdit(doc: vscode.TextDocument, m: AnyModel, id: string, newName: string): vscode.WorkspaceEdit {
    if (doc.uri.scheme === COMBINED_SCHEME) throw new Error(READ_ONLY);
    const r = rename(doc.getText(), m, id, newName);
    if (r.error !== undefined) throw new Error(r.error);
    const edit = new vscode.WorkspaceEdit();
    for (const e of r.edits) edit.replace(doc.uri, new vscode.Range(e.line, e.start, e.line, e.end), newName);
    if (state.doc === doc) state.renameKeys(id, renamedId(m, id, newName));
    return edit;
  }
}

export function deactivate() {}
