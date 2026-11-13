// Samma state i två sammansatta states: Mermaid ritar en enda state, i den sista som nämner den.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sharedStates } = require('../out/sharedStates');
const { parseDiagram } = require('../out/diagram');

const text = `stateDiagram-v2
  [*] --> Peldan
  Peldan --> Noltek
  state "Peldan" as Peldan {
    Torvani : Melnora
    [*] --> Torvani
    Torvani --> Vaskel : Drelmora
    Vaskel --> Torvani
  }
  state "asdasdasd" as Noltek {
    Torvani : Jeldrik
    [*] --> Drelkana
    Drelkana --> Torvani : Kelmora
  }`;

test('delad state: en varning i varje grupp, med alla användningar i just den gruppen', () => {
  const issues = sharedStates(text, parseDiagram(text));
  assert.deepEqual(issues.map(i => [i.id, i.group, i.drawnIn]), [['Torvani', 'Peldan', 'Noltek'], ['Torvani', 'Noltek', 'Noltek']]);
  const [peldan, noltek] = issues;
  // Deklarationen och de tre övergångarna i Peldan; beskrivningen och pilen i Noltek.
  assert.deepEqual(peldan.ranges.map(r => r.line), [4, 5, 6, 7]);
  assert.deepEqual(noltek.ranges.map(r => r.line), [10, 12]);
  assert.equal(peldan.message, '"Torvani" is also used in "asdasdasd" (Noltek). Mermaid draws it as one state there, so it is not shown here.');
  assert.equal(noltek.message, '"Torvani" is also used in Peldan. Mermaid draws it as one state, here, so it is missing there.');
});

test('delad state: varje varning pekar på första användningen i de andra grupperna', () => {
  const [peldan, noltek] = sharedStates(text, parseDiagram(text));
  assert.deepEqual(peldan.related.map(r => [r.group, r.line]), [['Noltek', 10]]);
  assert.deepEqual(noltek.related.map(r => [r.group, r.line]), [['Peldan', 4]]);
});

test('delad state: en pil på översta nivån till en state i en grupp är ingen delning', () => {
  const t = 'stateDiagram-v2\n  state W6 {\n    W6_Wait --> W6_F2\n  }\n  W6_F2 --> W7_Wait\n  state W7 {\n    W7_Wait --> x\n  }';
  assert.deepEqual(sharedStates(t, parseDiagram(t)), []);
});

test('delad state: ett namn som bara står som text på en pil räknas inte (Kelmora är en etikett ovan)', () => {
  const t = 'stateDiagram-v2\n  state A {\n    a --> b : Kelmora\n  }\n  state B {\n    Kelmora\n  }';
  assert.deepEqual(sharedStates(t, parseDiagram(t)), []);
});

test('delad state: i tre grupper ger en varning per grupp, och den där den ritas nämner de andra två', () => {
  const t = 'stateDiagram-v2\n  state A {\n    s\n  }\n  state B {\n    s\n  }\n  state C {\n    s\n  }';
  const issues = sharedStates(t, parseDiagram(t));
  assert.deepEqual(issues.map(i => [i.group, i.drawnIn]), [['A', 'C'], ['B', 'C'], ['C', 'C']]);
  assert.equal(issues[0].message, '"s" is also used in C. Mermaid draws it as one state there, so it is not shown here.');
  assert.equal(issues[2].message, '"s" is also used in A and B. Mermaid draws it as one state, here, so it is missing there.');
});

test('delad state: bara state diagram', () => {
  const t = 'flowchart LR\n  subgraph A\n    s\n  end\n  subgraph B\n    s\n  end';
  assert.deepEqual(sharedStates(t, parseDiagram(t)), []);
});

// ------------------------------------------------------------ eget namn i gruppen

const { ownNameSuggestion, ownNameProblem } = require('../out/sharedStates');

test('eget namn: förslaget är id:t och gruppen, med en siffra om det redan finns', () => {
  const m = parseDiagram(text);
  const [issue] = sharedStates(text, m);
  assert.equal(ownNameSuggestion(m, issue), 'Torvani_Peldan');
  const t2 = text.replace('Vaskel --> Torvani', 'Vaskel --> Torvani\n    Torvani_Peldan');
  const m2 = parseDiagram(t2);
  assert.equal(ownNameSuggestion(m2, sharedStates(t2, m2)[0]), 'Torvani_Peldan2');
});

test('eget namn: ett nytt giltigt id går bra; ett som redan finns eller inte är ett id gör det inte', () => {
  const m = parseDiagram(text);
  assert.equal(ownNameProblem(m, 'Melnora'), undefined);
  assert.match(ownNameProblem(m, 'Vaskel') ?? '', /already/);
  assert.match(ownNameProblem(m, 'Noltek') ?? '', /already/);
  assert.match(ownNameProblem(m, 'two words') ?? '', /not a valid/);
  assert.match(ownNameProblem(m, '') ?? '', /not a valid/);
});
