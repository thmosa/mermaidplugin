import * as vscode from 'vscode';
import { FlowEdge, visibility, neighborhood, nodeKey, edgeKey, subgraphKey } from './parser';
import { AnyModel, parseDiagram, filterDiagram } from './diagram';
import { caseConflicts } from './diagnostics';
import { checkSyntax } from './mermaidCheck';
import { syntaxDiagnostic } from './syntax';
import { Item, children, parentOf, initialState } from './tree';

const HIDDEN_STATE = 'mermaidTree.hidden';

function isMermaid(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'mermaid' || /\.(mmd|mermaid)$/i.test(doc.fileName);
}

// ---------------------------------------------------------------- tillstånd

/** Aktuellt diagram, dess modell och vilka element som är dolda. */
class DiagramState {
  doc: vscode.TextDocument | undefined;
  model: AnyModel | undefined;
  hidden = new Set<string>();

  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  setDocument(doc: vscode.TextDocument) {
    if (this.doc?.uri.toString() === doc.uri.toString()) return;
    this.doc = doc;
    const saved = this.ctx.workspaceState.get<Record<string, string[]>>(HIDDEN_STATE, {});
    this.hidden = new Set(saved[doc.uri.toString()] ?? []);
    this.reparse();
  }

  reparse() {
    this.model = this.doc ? parseDiagram(this.doc.getText()) : undefined;
    this.changed.fire();
  }

  setVisible(keys: string[], visible: boolean) {
    for (const k of keys) visible ? this.hidden.delete(k) : this.hidden.add(k);
    this.commit();
  }

  replaceHidden(keys: Iterable<string>) {
    this.hidden = new Set(keys);
    this.commit();
  }

  filteredText(): string {
    if (!this.doc || !this.model) return '';
    return filterDiagram(this.model, this.hidden);
  }

  private commit() {
    if (this.doc) {
      const saved = { ...this.ctx.workspaceState.get<Record<string, string[]>>(HIDDEN_STATE, {}) };
      saved[this.doc.uri.toString()] = [...this.hidden];
      void this.ctx.workspaceState.update(HIDDEN_STATE, saved);
    }
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
      : i.kind === 'subgraph' ? subgraphKey(i.id)
        : i.kind;

class StructureProvider implements vscode.TreeDataProvider<Item> {
  private readonly changed = new vscode.EventEmitter<Item | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  /** Samma objekt måste återanvändas för att reveal() ska hitta rätt rad i trädet. */
  private items = new Map<string, Item>();

  constructor(private readonly state: DiagramState) {
    state.onDidChange(() => { this.items.clear(); this.changed.fire(undefined); });
  }

  item(i: Item): Item {
    const k = itemKey(i);
    const existing = this.items.get(k);
    if (existing) return existing;
    this.items.set(k, i);
    return i;
  }

  find(kind: 'node' | 'subgraph', id: string): Item | undefined {
    const m = this.state.model;
    if (!m) return undefined;
    if (kind === 'node' && m.nodes.has(id)) return this.item({ kind, id });
    if (kind === 'subgraph' && m.subgraphs.has(id)) return this.item({ kind, id });
    return undefined;
  }

  getChildren(parent?: Item): Item[] {
    const m = this.state.model;
    return m ? children(m, parent).map(i => this.item(i)) : [];
  }

  getParent(i: Item): Item | undefined {
    const m = this.state.model;
    const p = m && parentOf(m, i);
    return p ? this.item(p) : undefined;
  }

  getTreeItem(i: Item): vscode.TreeItem {
    const m = this.state.model!;
    const vis = visibility(m, this.state.hidden);
    const check = (hidden: boolean) => hidden ? vscode.TreeItemCheckboxState.Unchecked : vscode.TreeItemCheckboxState.Checked;
    const label = (id: string) => m.nodes.get(id)?.label ?? m.subgraphs.get(id)?.title ?? id;
    const isState = /^stateDiagram/.test(m.diagramType);

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
        t.iconPath = new vscode.ThemeIcon(isState ? 'symbol-class' : 'symbol-namespace');
        t.contextValue = 'subgraph';
        t.checkboxState = check(this.state.hidden.has(subgraphKey(i.id)));
        if (!this.state.hidden.has(subgraphKey(i.id)) && vis.isSubgraphHidden(i.id)) t.description = 'hidden by parent';
        else if (sg.title !== i.id) t.description = i.id;
        return t;
      }
      case 'node': {
        const n = m.nodes.get(i.id)!;
        const t = new vscode.TreeItem(n.label);
        t.id = nodeKey(i.id);
        t.iconPath = new vscode.ThemeIcon(n.pseudo === 'start' ? 'debug-start' : n.pseudo === 'end' ? 'debug-stop' : 'symbol-constant');
        t.contextValue = 'node';
        t.checkboxState = check(this.state.hidden.has(nodeKey(i.id)));
        const viaParent = !this.state.hidden.has(nodeKey(i.id)) && vis.isNodeHidden(i.id);
        t.description = [n.label !== n.id && !n.pseudo ? n.id : '', viaParent ? (isState ? 'hidden by composite state' : 'hidden by subgraph') : ''].filter(Boolean).join(' · ');
        t.tooltip = `${n.id} – line ${n.line + 1}`;
        return t;
      }
      case 'edgeGroup': {
        const hiddenCount = m.edges.filter(e => vis.isEdgeHidden(e)).length;
        const t = new vscode.TreeItem(isState ? 'Transitions' : 'Edges', COLLAPSIBLE[initialState(i)]);
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
        const viaNode = !this.state.hidden.has(edgeKey(e.key)) && vis.isEdgeHidden(e);
        t.description = [e.label, viaNode ? (isState ? 'hidden by state' : 'hidden by node') : ''].filter(Boolean).join(' · ');
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

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly state: DiagramState,
    private readonly onClicked: (kind: 'node' | 'subgraph', id: string) => void,
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
    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'ready') { this.ready = true; this.update(); }
      if (msg.type === 'clicked') this.onClicked(msg.kind, msg.id);
    });
  }

  focus(kind: 'node' | 'subgraph', id: string) {
    if (this.ready) void this.panel?.webview.postMessage({ type: 'focus', kind, id });
  }

  private update() {
    if (!this.panel || !this.ready || !this.state.doc) return;
    this.panel.title = `Preview: ${vscode.workspace.asRelativePath(this.state.doc.uri)}`;
    void this.panel.webview.postMessage({ type: 'render', text: this.state.filteredText() });
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
  <span id="zoom-level"></span>
</div>`;

// ---------------------------------------------------------------- aktivering

export function activate(ctx: vscode.ExtensionContext) {
  const state = new DiagramState(ctx);
  const tree = new StructureProvider(state);
  const view = vscode.window.createTreeView('mermaidTree.structure', {
    treeDataProvider: tree, manageCheckboxStateManually: true, showCollapseAll: true,
  });

  const revealLine = (line: number) => {
    const editor = vscode.window.visibleTextEditors.find(e => e.document === state.doc);
    if (!editor) return;
    const range = editor.document.lineAt(line).range;
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  };

  const preview = new Preview(ctx, state, (kind, id) => {
    const item = tree.find(kind, id);
    if (item) void view.reveal(item, { select: true, focus: false });
    const m = state.model;
    const line = kind === 'node' ? m?.nodes.get(id)?.line : m?.subgraphs.get(id)?.line;
    if (line !== undefined) revealLine(line);
  });

  // Fel i editorn: Mermaids syntaxfel och id:n som bara skiljer i stora/små bokstäver.
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
    const found = caseConflicts(text, m).map(c => toDiagnostic(c, 'Mermaid Tree'));
    let err = null;
    try { err = await checkSyntax(text); } catch { /* Mermaid kunde inte laddas; visa bara våra egna fel */ }
    // En nyare version av texten hann komma medan Mermaid tolkade; den uppdaterar själv.
    if (doc !== state.doc || doc.version !== version) return;
    const syntax = err && syntaxDiagnostic(err, text);
    diagnostics.set(doc.uri, syntax ? [toDiagnostic(syntax, 'Mermaid'), ...found] : found);
  };
  state.onDidChange(() => void updateDiagnostics());
  // Diagramtypen visas bredvid panelens namn i stället för som en egen rotnod.
  state.onDidChange(() => { view.description = state.model?.diagramType || undefined; });

  const track = (editor: vscode.TextEditor | undefined) => {
    if (editor && isMermaid(editor.document)) state.setDocument(editor.document);
  };
  track(vscode.window.activeTextEditor);

  let timer: ReturnType<typeof setTimeout> | undefined;

  ctx.subscriptions.push(
    view,
    diagnostics,
    vscode.workspace.onDidCloseTextDocument(doc => diagnostics.delete(doc.uri)),
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
        else if (item.kind !== 'info') state.setVisible([itemKey(item)], visible);
      }
    }),

    view.onDidChangeSelection(e => {
      const item = e.selection[0];
      const m = state.model;
      if (!item || !m) return;
      if (item.kind === 'node') { revealLine(m.nodes.get(item.id)!.line); preview.focus('node', item.id); }
      if (item.kind === 'subgraph') { revealLine(m.subgraphs.get(item.id)!.line); preview.focus('subgraph', item.id); }
      if (item.kind === 'edge') revealLine(m.edges.find((x: FlowEdge) => x.key === item.key)!.line);
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

    vscode.commands.registerCommand('mermaidTree.focusNeighbors', (item?: Item) => {
      const m = state.model;
      const target = item ?? view.selection[0];
      if (!m || target?.kind !== 'node') return;
      const keep = neighborhood(m, target.id, 1);
      state.replaceHidden([...m.nodes.keys()].filter(id => !keep.has(id)).map(nodeKey));
      preview.focus('node', target.id);
    }),

    vscode.commands.registerCommand('mermaidTree.hideItem', (item?: Item) => {
      if (item && item.kind !== 'info' && item.kind !== 'edgeGroup') state.setVisible([itemKey(item)], false);
    }),
  );
}

export function deactivate() {}
