import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { functionsNamed, read } from './source.js';

/**
 * The one piece of selection logic that is written twice, held identical.
 *
 * Which `<source>` of a `<picture>` a browser reads is selection, and the
 * design gives `core` as selection's only home. This function is the exception
 * and it is a deliberate one: it walks `picture.children` and asks
 * `matchMedia`, and core declares no DOM types, so moving it there would mean
 * either DOM types in core or an adapter at both call sites that is the same
 * logic under another name. The copies stay, and this is what stands in for
 * the guarantee that having one would have given.
 *
 * The file sits at the repo root rather than in either package because the
 * property belongs to neither of them. It is a claim about two packages agreeing,
 * and a test that made it from inside one would be that package reading the
 * other's source to check itself.
 *
 * `imgwhy.js` at the root holds a third copy and is out of scope here. It is
 * the reference, it is untested by design, and it is not what ships — it also
 * diverges from both of these on purpose, which `no-type-negotiation.test.ts`
 * and `non-goals.test.ts` record.
 */
const COPIES = [
  ['the command line', '../packages/runner/src/collect.ts'],
  ['the extension', '../packages/extension/src/read.ts'],
] as const;

/**
 * Every function both packages bind, inside the function each one sends to a
 * page.
 *
 * `active` resolves a `<picture>`'s `<source>`. `declaresWidth` answers whether
 * the page gives an element a width of its own, which is what frees a row from
 * `can't tell`. Both are page-side reads `core` cannot hold, because `core`
 * declares no DOM types, and both are read by the command line and by the
 * extension — which is the whole shape of the problem this file exists for.
 */
const SHARED = ['active', 'declaresWidth'] as const;

/**
 * What a difference between the copies costs, said in the failure rather than
 * left in this comment.
 *
 * A reader who has just been shown two lines needs to know why the two lines
 * matter, and the answer is not "they differ". One copy fixed and the other
 * not is the command line and the extension naming different files as the one
 * the browser read, off the same page, with each one looking right on its own
 * and no test anywhere else catching it.
 */
const whyOf = (name: string): string =>
  [
    `The two copies of ${name}() have drifted.`,
    'Fix both or neither: the command line and the extension answer the same',
    'question from separate copies of this function. One changed alone is two',
    'front ends disagreeing about the same page, each of them looking right on',
    'its own.',
  ].join('\n');

/** One copy's text, by package and by name. */
const textOf = (path: string, name: string): string[] =>
  functionsNamed(read(fileURLToPath(new URL(path, import.meta.url))), name);

/** Every package against every shared function, as one table of cases. */
const CASES = COPIES.flatMap(([where, path]) =>
  SHARED.map((name): [string, string, string] => [name, where, path]),
);

/**
 * The lines that differ, named by line and by side.
 *
 * A line at a time rather than the two bodies, because the failure a reader
 * gets should be the change somebody made — the copies are thirteen lines
 * long, and printing both of them puts the one line that matters somewhere in
 * the middle of twenty-six.
 */
const drift = (name: string, left: string, right: string): string => {
  const [ours, theirs] = [left.split('\n'), right.split('\n')];
  const missing = '(the copy ends here)';
  const lines = [...ours, ...theirs]
    .map((_line, at) => at)
    .filter((at) => at < Math.max(ours.length, theirs.length))
    .filter((at) => ours[at] !== theirs[at])
    .map((at) =>
      [
        `line ${String(at + 1)}`,
        `  ${COPIES[0][0]}: ${ours[at] ?? missing}`,
        `  ${COPIES[1][0]}: ${theirs[at] ?? missing}`,
      ].join('\n'),
    );

  return lines.length === 0 ? '' : [whyOf(name), ...lines].join('\n\n');
};

describe('the functions the command line and the extension both hold', () => {
  it.each(CASES)(
    'declares %s exactly once in %s, so this reads what it means to',
    (name, _where, path) => {
      // A second declaration of the name, or none at all, is a reading that has
      // stopped answering the question — and comparing what it found would then
      // be a test that passes because it looked at nothing.
      expect(textOf(path, name)).toHaveLength(1);
    },
  );

  it.each(SHARED)('holds %s identical in both, so the two cannot answer differently', (name) => {
    const [ours, theirs] = COPIES.map(([, path]) => textOf(path, name)[0]);

    expect(drift(name, ours, theirs)).toBe('');
  });
});

/**
 * The check, read against copies that have drifted.
 *
 * Held here rather than tried on a branch and reverted, so what a drifted copy
 * should cause is a passing test rather than a line in a commit message. The
 * first case is the difference this issue found in the live copies; the second
 * is the one a formatter makes, which is the difference a check written over
 * text would most easily miss.
 */
describe('the reading, given copies that differ', () => {
  const ours = 'const active = (img) => {\n  return img.srcset;\n};';

  it('names the line and the side, rather than printing both copies', () => {
    const theirs = 'const active = (img) => {\n  return img.currentSrc;\n};';

    expect(drift('active', ours, theirs)).toContain('line 2');
    expect(drift('active', ours, theirs)).toContain('  the command line:   return img.srcset;');
    expect(drift('active', ours, theirs)).toContain('  the extension:   return img.currentSrc;');
  });

  it('says what a difference costs, so a reader is not left with two lines', () => {
    expect(drift('active', ours, 'const active = (img) => {\n  return img.src;\n};')).toContain(whyOf('active'));
  });

  it('fails on a copy that was only reformatted', () => {
    expect(drift('active', ours, 'const active = (img) => {\n    return img.srcset;\n};')).not.toBe('');
  });

  it('fails on a copy with a line added to the end of it', () => {
    const longer = 'const active = (img) => {\n  return img.srcset;\n  // and one more\n};';

    expect(drift('active', ours, longer)).toContain('(the copy ends here)');
  });
});

/**
 * The extraction, against the shapes the function could be written in.
 *
 * A declaration and an arrow are the two either copy has been; the nesting is
 * where both of them actually live, inside the body a page is handed. The last
 * two are what a miss looks like: a name that is not there at all, and a name
 * bound to something that is not a function, both of which would otherwise
 * hand the comparison an empty list to agree about.
 */
describe('reading a named function out of a module', () => {
  const cases: [string, string, number][] = [
    ['an arrow in a const', 'const active = (img) => img.srcset;', 1],
    ['a function declaration', 'function active(img) {\n  return img.srcset;\n}', 1],
    ['a function expression', 'const active = function (img) {\n  return img;\n};', 1],
    [
      'one nested inside the function it travels with',
      'const read = () => {\n  const active = (img) => img;\n  return active;\n};',
      1,
    ],
    [
      'two of them, which is a module to fix rather than to read',
      'const active = (a) => a;\nfunction active(b) {\n  return b;\n}',
      2,
    ],
    ['a name that is not there', 'const other = (img) => img;', 0],
    ['a name bound to something that is not a function', 'const active = 16;', 0],
  ];

  it.each(cases)('reads %s', (_shape, source, expected) => {
    expect(functionsNamed(source, 'active')).toHaveLength(expected);
  });
});
