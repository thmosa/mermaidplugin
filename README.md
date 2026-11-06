# Mermaid Tree

A structure tree and live preview for Mermaid diagrams in VS Code. Hide, show and collapse parts of a
large diagram without touching its source, and zoom around the result.

## Supported diagrams

| Diagram | Tree | Hide | Collapse |
| --- | --- | --- | --- |
| Flowchart | subgraphs, nodes, edges | nodes, edges, subgraphs | subgraphs into one box |
| State diagram | composite states, states, transitions | states, transitions, composite states | composite states into one box |
| Sequence diagram | participants (with boxes), messages, blocks and branches | participants, messages, boxes, blocks | `loop`, `alt`, `opt`, `par` … and each branch (`else`, `and`, `option`) |
| Class diagram | namespaces, classes, relations | classes, relations, namespaces | namespaces into one class |

Other diagram types are shown in the preview but have no tree yet.

## Features

- **Mermaid Structure** view in its own activity bar panel. Uncheck an item to hide it; groups start
  collapsed so large diagrams stay readable.
- **Preview** next to the editor, with zoom (Ctrl+scroll, pinch, `+` `-` `0` `1` `w`), pan, fit and a choice
  of layout, look and theme. The zoom stays where it was when the diagram changes. The `neo` look shows
  best together with the `neo` theme. The ELK layouts `elk.stress` and `elk.force` place nodes by
  force rather than in rows, so they can look scattered; that is how Mermaid draws them.
- **Click in the preview** to select the item in the tree and in the code. In sequence diagrams, click a
  block's keyword (`alt`, `loop` …) to collapse the whole block, its title to collapse its main branch, or a
  branch title (`[else …]`) to collapse that branch. Click the text on an arrow (a transition, message or
  relation) to go to that line.
- **Search Tree** (the search icon in the view's title bar) filters the tree as you type: names, ids, labels,
  messages and block titles. Groups open to show the matches; **Clear Search** shows everything again.
- **Show Only This and Its Neighbors** focuses on one node.
- **Participant suggestions** in sequence diagrams: when you start a message, after the arrow, in a note and
  after `activate`, `deactivate` and `destroy`, the participants in the diagram are suggested.
- **Change Participant…** (right-click a participant in a message, note or activate line of a sequence
  diagram) swaps just that occurrence for another existing participant. Rename changes every use.
- **Rename** a node, state, participant, class, subgraph or namespace with F2 in the editor or **Rename…** in
  the tree. Only real uses of the name change, not labels, messages or comments, and what is hidden or
  collapsed follows the new name.
- **Export** the whole diagram from the preview's toolbar as **SVG** or **PNG** (twice the natural size),
  as it is shown: with hidden parts left out, collapsed groups and the preview's background.
- **Errors in the editor**: Mermaid's own syntax errors on the right line, and ids that differ only in
  letter case (Mermaid treats `Order` and `order` as different).
- **Look-alike letters**: a warning on names with Cyrillic or Greek letters that look Latin, or full-width
  letters, such as `Оrder` with a Cyrillic `О`. Mermaid draws it as another name than `Order` although the
  code looks the same. The quick fix **Use Latin letters** changes every use, and joins it with `Order`
  when that name exists. Names written entirely in Cyrillic or Greek are fine unless they look exactly
  like another name.
- **Naming rules**: set `mermaidTree.namingStyle` to camelCase, PascalCase or snake_case to get a warning on
  names that do not follow it. The quick fix (Ctrl+.) renames one name, or all names in the file, the same
  way as Rename. **Fix All Naming Issues** in the editor's context menu and the Command Palette does the
  same for the whole file. To fix names on save, add `"source.fixAll.mermaidTree": "explicit"` to
  `editor.codeActionsOnSave`.
- **Editing support** for `.mmd` and `.mermaid` files: syntax highlighting, auto-closing brackets and quotes,
  and automatic indentation.

## Colors

**In the editor**, names get their own color, separate from labels, messages and keywords. The extension tells
VS Code what each name is (semantic highlighting), and your color theme picks the colors:

- `class`: classes in class diagrams
- `namespace`: groups (subgraphs, composite states, namespaces)
- `type`: other names (nodes, states, participants)

Where a name is defined it also has the `declaration` modifier. To choose the colors yourself:

```json
"editor.semanticTokenColorCustomizations": {
  "rules": {
    "type:mermaid": "#4FC1FF",
    "class:mermaid": "#4EC9B0",
    "namespace:mermaid": { "foreground": "#C586C0", "bold": true },
    "*.declaration:mermaid": { "underline": true }
  }
}
```

Before semantic highlighting is ready, and in themes that turn it off, the grammar colors names with the
scope `entity.name.type.node.mermaid`. Labels, arrows and the rest are colored by the grammar, and can be
changed with `editor.tokenColorCustomizations`:

```json
"editor.tokenColorCustomizations": {
  "textMateRules": [
    { "scope": "entity.name.type.node.mermaid", "settings": { "foreground": "#4FC1FF" } },
    { "scope": "string.unquoted.label.mermaid", "settings": { "foreground": "#CE9178" } },
    { "scope": "keyword.operator.arrow.mermaid", "settings": { "foreground": "#C586C0" } }
  ]
}
```

Other scopes: `keyword.control.mermaid` (keywords), `string.unquoted.title.mermaid` (block and box titles),
`string.unquoted.note.mermaid` (notes) and `comment.line.percentage.mermaid` (comments).

**In the preview**, `mermaidTree.preview.theme` picks Mermaid's theme (`auto` follows VS Code), and
`mermaidTree.preview.themeVariables` sets Mermaid's theme variables, for example
`{ "primaryColor": "#ffcc00" }` together with the theme `base`. Exports use the same colors. A diagram's own
`%%{init}%%` or front matter config still wins. The **Theme** menu in the preview tries another theme
without changing the setting; it follows the setting again as soon as the setting changes.

Hiding and collapsing never change the source file; only Rename does. What is hidden or collapsed is kept
while the file is open, and everything is shown again when it is reopened. Turn on the setting
`mermaidTree.rememberHiddenState` to remember it per file in the workspace instead. The gear in the
tree's title bar opens the extension's settings.

## Usage

Open a `.mmd` or `.mermaid` file, then use **Preview Diagram** or **View Tree** from the editor's context
menu or the editor title bar.

## Development

```bash
npm install
npm test
```

`npm test` runs the unit tests and the contract tests, which render the diagrams with the real Mermaid in an
installed Chrome or Edge (headless). `npm run package` builds the `.vsix`.

## License

MIT
