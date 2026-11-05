# Changelog

## Unreleased

- **Click the text on an arrow** in the preview (transition, message, relation) to select it in the tree
  and go to its line in the code.
- Everything is shown when a file is opened. What is hidden or collapsed is kept while the file is open; the
  new setting `mermaidTree.rememberHiddenState` keeps it after the file is closed, as before.
- **Settings** button (gear) in the tree's title bar opens the extension's settings.
- Fix: a state used in a transition outside its composite state is shown once, inside the composite state
  (as Mermaid draws it), instead of also at the top of the tree.

## 0.2.0

- **Search Tree**: filter the structure tree by name, id, label, message or block title. Matching groups open
  and the match is highlighted.
- **Export** the diagram from the preview as SVG or PNG.
- **Rename** (F2 in the editor, Rename… in the tree) for nodes, states, participants, classes, subgraphs and
  namespaces.
- Fix: composite states and subgraphs grow to fit wide edge labels, which Mermaid lets stick out of the box.
- Fix: a diagram that changes while the preview is hidden behind another tab is drawn when the preview is
  shown, instead of with zero-size labels.

## 0.1.0

- Structure tree with hide, show and collapse for flowcharts, state, sequence and class diagrams.
- Live preview with zoom, pan, layout and look, and clicking in the preview to select in the tree and code.
- Mermaid syntax errors and letter-case conflicts in the editor.
