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
  of layout and look. The zoom stays where it was when the diagram changes.
- **Click in the preview** to select the item in the tree and in the code. In sequence diagrams, click a
  block's keyword (`alt`, `loop` …) to collapse the whole block, its title to collapse its main branch, or a
  branch title (`[else …]`) to collapse that branch.
- **Show Only This and Its Neighbors** focuses on one node.
- **Errors in the editor**: Mermaid's own syntax errors on the right line, and ids that differ only in
  letter case (Mermaid treats `Order` and `order` as different).
- **Editing support** for `.mmd` and `.mermaid` files: syntax highlighting, auto-closing brackets and quotes,
  and automatic indentation.

The source file is never changed. What is hidden or collapsed is remembered per file in the workspace.

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
