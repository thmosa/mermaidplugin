// En pils riktning för Show Chain. Egen modul utan beroenden, så att parserna kan använda den.

/** forward: från första till andra namnet på raden; backward: tvärtom; both: ingen riktning. */
export type ArrowDirection = 'forward' | 'backward' | 'both';

const toDirection = (right: boolean, left: boolean): ArrowDirection =>
  right && !left ? 'forward' : left && !right ? 'backward' : 'both';

/**
 * Riktningen pilen pekar. Class diagram: pilspetsar (> |>) pekar dit de sitter, och en romb (* o)
 * pekar från helheten, där den sitter, till delen. Flowchart: spetsarna > o x. Utan spets: både och.
 */
export function arrowDirection(arrow: string, kind: 'class' | 'flow'): ArrowDirection {
  const a = arrow.trim();
  if (kind === 'class') {
    const m = /^(<\||\*|o|<|\(\))?(?:--|\.\.)(\|>|\*|o|>|\(\))?$/.exec(a);
    if (!m) return 'both';
    const [, left, right] = m;
    return toDirection(right === '>' || right === '|>' || left === '*' || left === 'o',
      left === '<' || left === '<|' || right === '*' || right === 'o');
  }
  // Flowchart: utan kant-id (e1@) och text mellan |…|.
  const link = a.replace(/^[^\s@]+@/, '').replace(/\|[^|]*\|$/, '').trim();
  return toDirection(/[-=.][>ox]$/.test(link), /^[<ox][-=.]/.test(link));
}
