import vm from 'node:vm';
import type { CapturedImage, DeviceProfile, Selection } from '@imgwhy/core';
import { coreSource, explainSelection, parseSrcset } from '@imgwhy/core';
import { renderReport as renderBuilt } from '@imgwhy/report';
import { beforeAll, describe, expect, it } from 'vitest';
import { refuseStaleBuild } from '../../../test/built.js';
import { renderReport } from '../src/index.js';
import { readPanel } from '../src/panel.js';
import type { Readout } from '../src/panel.js';
import { gallery } from './capture.js';
import { scripts } from './document.js';

/**
 * The report's script, run where it runs: a context holding the language and
 * a `document`, and nothing else.
 *
 * This is the check that the file works, rather than that it says the right
 * things. Both halves of the script arrive as the source of functions —
 * `coreSource()` for the algorithm, `String(readPanel)` for the words — and a
 * function shipped that way arrives with none of its module around it. A
 * helper left behind, or a build that rewrote a call to another module into a
 * call through an import object, is a `ReferenceError` in someone's browser
 * and nothing at all in a test that only reads the text. So the text is run.
 *
 * The wiring finds no island in this context and stops, which is what makes
 * the declarations readable through the trailing expression: a `const` at the
 * top of a script goes to the context's lexical scope and never becomes a
 * property of its global.
 */
function inPage(report: string): Record<string, unknown> {
  const script = scripts(report).find((one) => one.type === '');
  if (!script) throw new Error(`the report ships no script to run:\n${report}`);
  const context = vm.createContext({ document: { querySelector: () => null } });
  const read = '\n;({ parseSrcset, resolveSizes, selectCandidate, explainSelection, readPanel })';
  return vm.runInContext(script.text + read, context) as Record<string, unknown>;
}

const WIDTHS = '/i/640.png 640w, /i/1080.png 1080w, /i/1920.png 1920w';
const DENSITIES = '/i/200.png 1x, /i/300.png 2x';

const imageOf = (srcset: string, sizes: string | null, renderedWidth = 375): CapturedImage => ({
  id: 'main > img',
  selector: 'main > img',
  candidates: parseSrcset(srcset),
  sizes,
  sizesSource: 'img',
  renderedWidth,
  currentSrc: '',
  naturalWidth: 0,
  transferBytes: null,
  loading: null,
});

const deviceOf = (width: number, dpr: number): DeviceProfile => ({
  id: 'typed',
  name: 'typed',
  viewport: { width, height: 800 },
  dpr,
});

/**
 * What a reader types, one case per branch of the arithmetic.
 *
 * These are counterfactuals rather than measurements: every one of them is a
 * `sizes` string, a viewport or a ratio that no device in the Capture had. A
 * branch missing from this table is a branch whose helper could go missing
 * from the shipped copy without anything failing.
 */
const TYPED: [string, CapturedImage, DeviceProfile][] = [
  ['a wider viewport than any device had', imageOf(WIDTHS, '100vw'), deviceOf(2560, 2)],
  ['a media clause the reader wrote', imageOf(WIDTHS, '(min-width: 700px) 33vw, 100vw'), deviceOf(1024, 2)],
  ['a calc() the reader wrote', imageOf(WIDTHS, 'calc(100vw - 4rem)'), deviceOf(1440, 1)],
  ['an em clause', imageOf(WIDTHS, '(max-width: 40em) 20em, 50vw'), deviceOf(600, 3)],
  ['auto, which layout decides', imageOf(WIDTHS, 'auto', 300), deviceOf(1440, 2)],
  ['a clause carrying no length', imageOf(WIDTHS, 'wide'), deviceOf(375, 2)],
  ['an emptied sizes box', imageOf(WIDTHS, null), deviceOf(375, 2)],
  ['a ratio past every density', imageOf(DENSITIES, '100vw'), deviceOf(393, 4)],
  ['a fractional ratio', imageOf(WIDTHS, '50vw'), deviceOf(412, 2.625)],
  ['nothing to select at all', imageOf('', null), deviceOf(1440, 1)],
];

/** The readout as this package makes it, which is what the page must match. */
const here = (image: CapturedImage, device: DeviceProfile): Readout =>
  readPanel(explainSelection(image, device), image.candidates, device.dpr);

describe('the script the report ships, run the way a page runs it', () => {
  const report = renderReport(gallery());
  const page = inPage(report);

  it('brings core and the readout over, and stops when it finds no data to wire', () => {
    expect(Object.keys(page).sort()).toEqual([
      'explainSelection',
      'parseSrcset',
      'readPanel',
      'resolveSizes',
      'selectCandidate',
    ]);
  });

  it.each(TYPED)('recomputes %s exactly as this package does', (_case, image, device) => {
    const explain = page.explainSelection as typeof explainSelection;
    const read = page.readPanel as typeof readPanel;

    const inTheFile = read(explain(image, device), image.candidates, device.dpr);

    expect(inTheFile).toEqual(here(image, device));
  });

  it('marks the candidate that won, which needs the object the page parsed', () => {
    // The mark is identity: `readPanel` compares each candidate against the one
    // core picked. That only holds if the page hands core the same array it
    // hands the readout, which is the wiring's job and not core's.
    const explain = page.explainSelection as typeof explainSelection;
    const read = page.readPanel as typeof readPanel;
    const image = imageOf(WIDTHS, '100vw');

    expect(read(explain(image, deviceOf(375, 2)), image.candidates, 2).marks).toEqual([
      '',
      '← picked',
      '',
    ]);
  });

  it('is the source of the functions themselves, so it cannot be a copy that drifted', () => {
    expect(report).toContain(coreSource());
    expect(report).toContain(String(explainSelection));
    expect(report).toContain(String(readPanel));
  });

  it('would not hold for a copy of core with a character changed in it', () => {
    // What the check above is worth, shown rather than claimed: a copy is a
    // copy the moment anything about it differs, and the file carries the
    // original rather than something that resembles it.
    const drifted = String(explainSelection).replace('byWidth', 'byWidthCopy');

    expect(drifted).not.toBe(String(explainSelection));
    expect(report).not.toContain(drifted);
  });

  it('agrees with the panel this package rendered into the same file', () => {
    // The two ends of the same claim: the arithmetic in the document and the
    // arithmetic the controls produce are one function, so a reader who types
    // the recorded numbers back in gets the page they started with.
    const explain = page.explainSelection as typeof explainSelection;
    const read = page.readPanel as typeof readPanel;
    const hero = gallery().runs[0].images[1];
    const device = gallery().devices[0];

    const recomputed = read(explain(hero, device), hero.candidates, device.dpr);

    expect(report).toContain(`<dd class="clause">${recomputed.clause}</dd>`);
    expect(report).toContain(`<dd class="picked">${recomputed.picked}</dd>`);
    expect(report).toContain(`<p class="reason">${recomputed.reason}</p>`);
  });
});

/**
 * The same script, out of the package as it is built rather than as it is
 * written.
 *
 * Everything above renders through `../src`, which Vitest transforms on the
 * way in. `String(readPanel)` is the one call in this package whose answer
 * that changes: it reads the text of a function, so a test of it reads
 * whatever the transform left, and a reader's file carries whatever `tsc`
 * emitted. The two are not the same string — `tsc` re-indents the helper
 * inside `readPanel` — and nothing here would have noticed if they had also
 * stopped meaning the same thing.
 *
 * They can. The two compilers do not target the same language: this package
 * builds to ES2022 and Vite's transform targets whatever the running Node
 * understands. A syntax `tsc` downlevels — a private field, a decorator, an
 * operator newer than the target — arrives in `dist` as a call to a helper
 * `tsc` wrote at the top of the module, which is exactly the kind of name that
 * does not come over with a function. Vite would have left the syntax alone,
 * so the source-side check above would pass while a reader's file threw.
 *
 * `vitest.config.ts` externalises `packages/report/dist` so this import is the
 * built file rather than another transform of the source, and
 * `refuseStaleBuild` refuses a `dist` older than the `src` beside it, because
 * a stale build would make every check below a check of last week's code.
 *
 * That is why the whole difference is checked by behaviour rather than by
 * text. The bytes are allowed to differ; the answers are not.
 */
describe('the script the built package ships, which is the copy a reader gets', () => {
  beforeAll(refuseStaleBuild);

  it('brings core and the readout over, the same five names the source does', () => {
    expect(Object.keys(inPage(renderBuilt(gallery()))).sort()).toEqual([
      'explainSelection',
      'parseSrcset',
      'readPanel',
      'resolveSizes',
      'selectCandidate',
    ]);
  });

  it.each(TYPED)('recomputes %s exactly as the source does', (_case, image, device) => {
    const page = inPage(renderBuilt(gallery()));
    const explain = page.explainSelection as typeof explainSelection;
    const read = page.readPanel as typeof readPanel;

    expect(read(explain(image, device), image.candidates, device.dpr)).toEqual(here(image, device));
  });
});

/**
 * The check, read against a script with a piece missing.
 *
 * Held here rather than tried on a branch and reverted, so the failure a
 * function reaching outside itself should cause is a passing test instead of a
 * note in a commit message.
 */
describe('the shipped script, given a function that reaches outside itself', () => {
  it('throws where a helper it called did not come over', () => {
    const report = renderReport(gallery());
    const script = scripts(report).find((one) => one.type === '');
    const shipped = script?.text ?? '';
    const withoutRound = shipped.replace('const round = (px) => `${Math.round(px)}px`;', '');
    // The edit has to have landed, or the rest of this proves nothing.
    expect(withoutRound).not.toBe(shipped);

    const context = vm.createContext({ document: { querySelector: () => null } });
    const read = withoutRound + '\n;({ readPanel })';

    const page = vm.runInContext(read, context) as { readPanel: typeof readPanel };
    const selection: Selection = {
      kind: 'width',
      resolution: { kind: 'length', px: 375, clause: '100vw', cond: null },
      cssPx: 375,
      neededPx: 750,
      picked: null,
    };

    expect(() => page.readPanel(selection, parseSrcset(WIDTHS), 2)).toThrow(
      /round is not defined/,
    );
  });
});
