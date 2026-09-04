import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse, read, sources } from '../../../test/source.js';

const src = fileURLToPath(new URL('../src', import.meta.url));

/** A package as this check reads it: module name → the source it holds. */
type Modules = Record<string, string>;

/** The module that runs inside the page, which is the only one that can see a tag. */
const IN_PAGE = 'collect.ts';

/**
 * Every member the code that runs inside the page reads or writes.
 *
 * An allowlist rather than a list of members to refuse, and that is the point
 * of it. `type` is one way to ask what format a `<source>` offers; `toDataURL`,
 * `canPlayType` and `createImageBitmap` are three more, and so is whatever the
 * next of them turns out to be called. A list of the ones to refuse is a list
 * someone has to keep complete. This one refuses everything not named, so a
 * negotiation cannot arrive by being forgotten. Adding a name is the deliberate
 * act.
 *
 * It is tractable because the page-side code is small and fixed: one function
 * that reads every `<img>` and one that counts painted backgrounds. Thirty
 * names is the whole surface either of them has on the DOM, and the fields of
 * `RawImage` are in here too — so a format reaching the seam under some other
 * name is a finding as much as a `type` read is.
 */
const MEMBERS = new Set([
  'aspectRatio',
  'backgroundImage',
  'children',
  'closest',
  'currentSrc',
  'declaresWidth',
  'filter',
  'from',
  'getAttribute',
  'getBoundingClientRect',
  'images',
  'includes',
  'indexOf',
  'join',
  'length',
  'loading',
  'map',
  'matches',
  'media',
  'naturalWidth',
  'parentElement',
  'querySelectorAll',
  'renderedWidth',
  'selector',
  'sizes',
  'sizesSource',
  'src',
  'style',
  'srcset',
  'tagName',
  'toLowerCase',
  'unshift',
  'width',
]);

/**
 * Every string the page-side code writes. An allowlist, for the same reason.
 *
 * A member allowlist alone would miss the two shapes a negotiation takes as
 * text rather than as a property: `getAttribute('type')`, and a selector that
 * filters the sources — `source:not([type])` — which asks the same question
 * with no `.type` anywhere in the file.
 */
const STRINGS = new Set([
  '',
  ' > ',
  ')',
  '*',
  ':nth-of-type(',
  'auto',
  'eager',
  'img',
  'lazy',
  'loading',
  'none',
  'picture',
  'source',
  'url(',
  'width',
]);

/**
 * Members refused by name as well as by absence from the allowlist above.
 *
 * The allowlist already covers the shipped module. This covers the next
 * contributor, who adds a name to it because one read seemed harmless. Both
 * lists have to be edited to introduce a negotiation, and the line this
 * produces says which of them stopped it.
 *
 * It is also the whole of the check over the rest of the package. `collect.ts`
 * is the only module that runs in a page, so it is the only one an allowlist
 * this small can be written for; every other module still has to ask no
 * question about a format, and this is what says so.
 */
const NEGOTIATES: [RegExp, string][] = [
  [/^type$/, 'the type attribute'],
  [/^(?:toDataURL|canPlayType|createImageBitmap)$/, 'a probe for what a format decodes to'],
  [/^(?:HTMLCanvasElement|OffscreenCanvas)$/, 'a canvas, which is how a page probes a format'],
];

/** Strings refused by name, one line each, for the same reason. */
const NAMES_A_FORMAT: [RegExp, string][] = [
  [/^type$/, 'the type attribute'],
  [/\[\s*type\b/, 'a selector that reads the type attribute'],
  [/\bimage\/[a-z0-9]/i, 'a MIME image type'],
  [/\b(?:avif|webp|jxl|heic)\b/i, 'an image format'],
  [/\bcanvas\b/i, 'a canvas, which is how a page probes a format'],
];

/** The name a property is written under, with any quotes taken off. */
const nameOf = (name: ts.PropertyName): string =>
  ts.isStringLiteralLike(name) ? name.text : name.getText();

/** Every part of a template that is text rather than an interpolation. */
const isText = (node: ts.Node): node is ts.LiteralLikeNode =>
  ts.isStringLiteralLike(node) ||
  ts.isTemplateHead(node) ||
  ts.isTemplateMiddle(node) ||
  ts.isTemplateTail(node);

/**
 * What one module touches: every member it names, and every string it writes.
 *
 * A syntax tree rather than a regex over the text, for the reason `source.ts`
 * gives: a tree holds no comments, so the word `type` in a doc comment
 * explaining that no `type` is read is not itself a finding, and it holds every
 * form a member can be named in rather than the forms whoever wrote the pattern
 * thought of. Five of those forms name one:
 *
 * ```ts
 * source.type            // a property access
 * source['type']         // an element access
 * { type: source.type }  // an object literal, and its shorthand
 * const { type } = source
 * type RawImage = { type: string }   // and a field on the seam
 * ```
 */
function surface(text: string): { members: string[]; strings: string[] } {
  const members: string[] = [];
  const strings: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) members.push(node.name.text);
    else if (ts.isElementAccessExpression(node) && isText(node.argumentExpression)) {
      members.push(node.argumentExpression.text);
    } else if (ts.isPropertyAssignment(node) || ts.isPropertySignature(node)) {
      members.push(nameOf(node.name));
    } else if (ts.isShorthandPropertyAssignment(node)) members.push(node.name.text);
    else if (ts.isBindingElement(node)) {
      const bound = node.propertyName ?? node.name;
      if (ts.isIdentifier(bound)) members.push(bound.text);
    } else if (isText(node)) strings.push(node.text);
    ts.forEachChild(node, visit);
  };

  visit(parse(text));
  return { members, strings };
}

/** The first reason a list gives for one name, or nothing. */
const why = (rules: [RegExp, string][], name: string): string | undefined =>
  rules.find(([pattern]) => pattern.test(name))?.[1];

/**
 * Why one member is refused, or null where the code may read it.
 *
 * Two lists in one answer, and the order matters: a name `NEGOTIATES` holds is
 * refused whatever `allowed` says, and the line it produces says so. `allowed`
 * is null for a module no allowlist was written for, and then absence alone is
 * not a finding — which is what lets the same reading cover the whole package
 * and the page-side module at two different strengths.
 */
const refusedMember = (member: string, allowed: Set<string> | null): string | null => {
  const reason = why(NEGOTIATES, member);
  if (reason !== undefined) return `reads ${member}, which is ${reason}`;
  if (allowed !== null && !allowed.has(member)) return `reads ${member}`;
  return null;
};

/** The same answer for a string, and for the same two reasons. */
const refusedString = (value: string, allowed: Set<string> | null): string | null => {
  const reason = why(NAMES_A_FORMAT, value);
  if (reason !== undefined) return `writes "${value}", which names ${reason}`;
  if (allowed !== null && !allowed.has(value)) return `writes "${value}"`;
  return null;
};

/** Every way one module leaves the two lists, one line each. Empty is clean. */
function findings(
  text: string,
  members: Set<string> | null,
  strings: Set<string> | null,
): string[] {
  const touched = surface(text);
  const found = [
    ...touched.members.map((member) => refusedMember(member, members)),
    ...touched.strings.map((value) => refusedString(value, strings)),
  ];
  return [...new Set(found.filter((line): line is string => line !== null))];
}

/** Every way one module asks what a format is, by name alone. */
const probing = (text: string): string[] => findings(text, null, null);

/** That, and everything outside the two allowlists as well. */
const beyondThePage = (text: string): string[] => findings(text, MEMBERS, STRINGS);

/**
 * The design's non-goal, as a check rather than an inspection:
 *
 * > **`<picture>` type negotiation.** Evaluate `media` only. Do not model AVIF
 * > against WebP support.
 *
 * A negotiation that ran would produce answers that look exactly like the ones
 * the tool is for — a candidate list, a picked file — so this is checked in the
 * source rather than only in a result. A result can only ever show that today's
 * code negotiates nothing.
 *
 * The reference implementation this slice was ported from carries a dead
 * `type`-sniffing branch. It was not ported, and this is what says so, for the
 * next port as much as for that one.
 *
 * ## What this file does not have to answer for
 *
 * - **`core`.** Its whole contract is that it sees no host at all, which
 *   `no-globals.test.ts` holds. It is handed a `Capture`, and a `Capture`
 *   carries no format field for it to negotiate with — `CapturedImage` names
 *   nine fields and none of them is a MIME type.
 * - **`report`.** It ships a script into a page, and the allowlists in
 *   `self-contained.test.ts` already refuse every name that script would need:
 *   `createElement` is not in `CALLED`, and `HTMLCanvasElement` is not in
 *   `GLOBALS`.
 * - **`cli`.** It reads a Capture and prints columns. Same absence of a field.
 */
describe('picture resolution, checked against type negotiation', () => {
  /** The package as the check reads it, keyed the way it imports itself. */
  const modules: Modules = Object.fromEntries(
    sources(src).map((file) => [relative(src, file).split(/[\\/]/).join('/'), read(file)]),
  );

  it('has the page-side module to check, so nothing below passes for want of a file', () => {
    expect(Object.keys(modules)).toContain(IN_PAGE);
    // The check reads the module it meant to read, rather than passing on a
    // renamed file whose surface happens to be empty.
    expect(surface(modules[IN_PAGE] ?? '').members).toContain('media');
  });

  it('reads media and nothing else off a source, so it can only evaluate a condition', () => {
    expect(beyondThePage(modules[IN_PAGE] ?? '')).toEqual([]);
  });

  it('asks no module in the package what a format is', () => {
    const found = Object.entries(modules).flatMap(([name, text]) =>
      probing(text).map((line) => `${name} ${line}`),
    );

    expect(found).toEqual([]);
  });
});

/**
 * The check, read against a runner written to negotiate anyway.
 *
 * Each module below is a real way to put format support back in the decision,
 * and they are held here rather than tried on a branch and reverted, so the
 * failure they should cause is a passing test instead of a note in a commit
 * message.
 *
 * ## What still gets past
 *
 * - **A negotiation in a module reached at run time.** `boundary.test.ts`
 *   refuses a computed `import()` for the whole package, which is the backstop.
 * - **A member name the code only has when it runs.** `source['ty' + 'pe']`
 *   names nothing this reading can see. The allowlist is what narrows it: the
 *   element access would have to be reached through a member, and every member
 *   the page-side code may read is named above.
 * - **A format negotiated by the server.** An `Accept` header is not something
 *   the runner sends; Chromium does, and what comes back is what the page got.
 *   Measuring that is not modelling it.
 */
describe('the negotiation check, given a runner that negotiates anyway', () => {
  it('is quiet about the arrangement that ships', () => {
    expect(
      beyondThePage(`const active = (img: HTMLImageElement) => {
        const picture = img.closest('picture');
        if (!picture) return { srcset: img.srcset, sizes: img.sizes, sizesSource: 'img' };
        for (const child of Array.from(picture.children)) {
          if (child === img) break;
          if (child.tagName.toLowerCase() !== 'source') continue;
          const source = child as HTMLSourceElement;
          if (source.media && !matchMedia(source.media).matches) continue;
          if (source.srcset) return { srcset: source.srcset, sizes: source.sizes, sizesSource: 'source' };
        }
      };`),
    ).toEqual([]);
  });

  it('catches the type attribute read straight off a source', () => {
    expect(
      beyondThePage(`const active = (img) => {
        for (const source of img.closest('picture').querySelectorAll('source')) {
          if (source.type) continue;
        }
      };`),
    ).toEqual(['reads type, which is the type attribute']);
  });

  it('catches the type attribute read through an element access', () => {
    // Two rules see it, because the argument is both a member and a string.
    expect(beyondThePage("const negotiate = (source) => source['type'];")).toEqual([
      'reads type, which is the type attribute',
      'writes "type", which names the type attribute',
    ]);
  });

  it('catches the type attribute asked for by name', () => {
    expect(beyondThePage("const negotiate = (source) => source.getAttribute('type');")).toEqual([
      'writes "type", which names the type attribute',
    ]);
  });

  it('catches a selector that filters the sources, which names no member at all', () => {
    expect(
      beyondThePage("const usable = (picture) => picture.querySelectorAll('source:not([type])');"),
    ).toEqual(['writes "source:not([type])", which names a selector that reads the type attribute']);
  });

  it('catches the canvas the reference probes support with', () => {
    expect(
      beyondThePage(`const supports = (mime: string) =>
        document.createElement('canvas').toDataURL(mime).startsWith('data:' + mime);`),
    ).toEqual([
      'reads startsWith',
      'reads toDataURL, which is a probe for what a format decodes to',
      'reads createElement',
      'writes "canvas", which names a canvas, which is how a page probes a format',
      'writes "data:"',
    ]);
  });

  it('catches a list of the formats a browser is assumed to take', () => {
    expect(
      beyondThePage("const SUPPORTED = ['image/avif', 'image/webp'];"),
    ).toEqual([
      'writes "image/avif", which names a MIME image type',
      'writes "image/webp", which names a MIME image type',
    ]);
  });

  it('catches a format carried to the seam under a field of its own', () => {
    expect(beyondThePage('export type RawImage = { srcset: string; type: string | null };')).toEqual(
      ['reads type, which is the type attribute'],
    );
  });

  it('catches a member with no format meaning at all, because the list refuses by absence', () => {
    expect(beyondThePage('const how = (img) => img.decoding;')).toEqual(['reads decoding']);
  });

  it('refuses a negotiating member even where the allowlist has been loosened', () => {
    // What `NEGOTIATES` is for, and the only way to show it: the shipped module
    // reaches neither list, so nothing about the arrangement above would change
    // if it were deleted. The edit it exists for is one to `MEMBERS` — a
    // contributor who allowed a read because the one in front of them seemed
    // harmless — and this is the list that does not move with it.
    expect(probing('const negotiate = (source) => source.type;')).toEqual([
      'reads type, which is the type attribute',
    ]);
    expect(probing('const tag = (element) => element.tagName;')).toEqual([]);
  });

  it('reads nothing out of a comment, which a regex over the text cannot help', () => {
    expect(
      beyondThePage(`/** Never \`source.type\`, and never an 'image/avif' probe on a canvas. */
        export const plain = (img) => img.srcset;`),
    ).toEqual([]);
  });
});
