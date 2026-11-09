# Changelog

## 0.6.0

- **Show in Diagram**: right-click a line in the code or an item in the tree to open the preview and zoom to the
  element. On a line, the name under the cursor comes first, otherwise what the line is about. If the element is
  hidden you are told so and nothing is highlighted; inside a collapsed group the group is shown.
- **Similar names**: a warning on names that differ only in word separation, such as `orderplanned` and
  `order_planned`, with a quick fix that uses one of them everywhere.
- The name checks can be turned off one by one with `mermaidTree.checks.letterCase`, `similarNames` and
  `lookalikeLetters`.
- Fix: hiding something no longer moves the highlight in the preview to another element. A selected arrow text is
  cleared when the arrow texts change, and a hidden group is no longer mixed up with a group whose id ends the same.

## 0.5.0

- **Combine Class Diagrams…**: choose two or more class diagrams and see them drawn as one, in a read-only
  view that follows the files. Classes with the same name become one, so relations connect across the files.
  Members and relations found in several files are shown once, and different labels, namespaces or directions
  get a warning. Clicking something opens the right file and line.
- **Look-alike letters**: a warning, with the quick fix *Use Latin letters*, on names with Cyrillic, Greek or
  full-width letters that look like Latin ones.
- **Theme menu** in the preview, and Mermaid 12's new themes (`neo`, `neo-dark`, `redux`, `redux-dark`,
  `redux-color`, `redux-dark-color`) in `mermaidTree.preview.theme`.

## 0.4.0

- **Participant suggestions** in sequence diagrams: at the start of a message, after the arrow, in notes and
  after `activate`, `deactivate` and `destroy`.
- **Colors**: names get their own color in the editor through semantic highlighting (`type`, `class` and
  `namespace`, with `declaration` where a name is defined), which can be recolored with
  `editor.semanticTokenColorCustomizations`. The preview's Mermaid theme and theme variables
  are settings (`mermaidTree.preview.theme`, `mermaidTree.preview.themeVariables`).
- The preview fits the whole diagram when you switch to another file, and keeps the zoom while you edit
  the same file.
- Fix: `Note` with a capital N (and `create`, `destroy`) is highlighted like the other keywords.

## 0.3.0

- **Change Participant…** in the editor's context menu for sequence diagrams: swap one occurrence of a
  participant for another existing one.
- **Click the text on an arrow** in the preview (transition, message, relation) to select it in the tree
  and go to its line in the code.
- Everything is shown when a file is opened. What is hidden or collapsed is kept while the file is open; the
  new setting `mermaidTree.rememberHiddenState` keeps it after the file is closed, as before.
- **Naming rules**: the setting `mermaidTree.namingStyle` (camelCase, PascalCase or snake_case) warns about
  names that do not follow it, with quick fixes that rename one name or all names in the file, the command
  **Fix All Naming Issues**, and `source.fixAll.mermaidTree` for fixing on save.
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
