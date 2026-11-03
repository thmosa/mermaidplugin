import * as vscode from 'vscode';
import { FlowEdge, visibility, neighborhood, nodeKey, edgeKey, subgraphKey, collapseKey } from './parser';
import { AnyModel, parseDiagram, renderInfo } from './diagram';
import { SequenceModel, SequenceRender, blockSuppressor } from './sequenceParser';
import { caseConflicts } from './diagnostics';
import { checkSyntax } from './mermaidCheck';
import { syntaxDiagnostic } from './syntax';
import { Item, children, parentOf, initialState } from './tree';
import { idAt, rename, renameKeys, renamedId } from './rename';

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

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly state: DiagramState,
    private readonly onClicked: (kind: 'node' | 'subgraph' | 'block', id: string, toggle: boolean, branch: boolean) => void,
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
      if (msg.type === 'clicked') this.onClicked(msg.kind, msg.id, msg.toggle === true, msg.branch === true);
    });
  }

  focus(kind: 'node' | 'subgraph' | 'block', id: string) {
    if (this.ready) void this.panel?.webview.postMessage({ type: 'focus', kind, id });
  }

  private update() {
    if (!this.panel || !this.ready || !this.state.doc) return;
    this.panel.title = `Preview: ${vscode.workspace.asRelativePath(this.state.doc.uri)}`;
    void this.panel.webview.postMessage({ type: 'render', ...this.state.rendered() });
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
        else if (item.kind !== 'info' && item.kind !== 'participants') state.setVisible([itemKey(item)], visible);
      }
    }),

    view.onDidChangeSelection(e => {
      const item = e.selection[0];
      const m = state.model;
      if (!item || !m) return;
      if (item.kind === 'node') { revealLine(m.nodes.get(item.id)!.line); preview.focus('node', item.id); }
      if (item.kind === 'subgraph') { revealLine(m.subgraphs.get(item.id)!.line); preview.focus('subgraph', item.id); }
      if (item.kind === 'edge') revealLine(m.edges.find((x: FlowEdge) => x.key === item.key)!.line);
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

    // Byt namn (F2 och Rename Symbol i editorns högerklicksmeny).
    vscode.languages.registerRenameProvider({ language: 'mermaid' }, {
      prepareRename(doc, pos) {
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

  /** Ändringarna för ett namnbyte. Det som är dolt och hopfällt följer med till det nya namnet. */
  function renameEdit(doc: vscode.TextDocument, m: AnyModel, id: string, newName: string): vscode.WorkspaceEdit {
    const r = rename(doc.getText(), m, id, newName);
    if (r.error !== undefined) throw new Error(r.error);
    const edit = new vscode.WorkspaceEdit();
    for (const e of r.edits) edit.replace(doc.uri, new vscode.Range(e.line, e.start, e.line, e.end), newName);
    if (state.doc === doc) state.renameKeys(id, renamedId(m, id, newName));
    return edit;
  }
}

export function deactivate() {}
