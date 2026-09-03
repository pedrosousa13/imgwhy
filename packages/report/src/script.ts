import { coreSource } from '@imgwhy/core';
import { script } from './html.js';
import type { Html } from './html.js';
import { readPanel } from './panel.js';

/**
 * What the page does when someone types in a control.
 *
 * This is JavaScript written for the page, held here as text, the way
 * `style.ts` holds the stylesheet. It is not TypeScript for this package and
 * the compiler here does not check it — deliberately: `tsconfig.json` declares
 * no DOM, because a package that turns a Capture into a string has no business
 * reaching for a `document`, and loosening that to typecheck twenty lines of
 * wiring would be the wrong trade. What checks these lines is the browser: the
 * command's `report.test.ts` opens an emitted file in Chromium, types into a
 * control and reads the selection back out.
 *
 * The wiring is all it is. Every decision below it belongs to something that
 * *is* checked here: the arithmetic is `explainSelection`, which arrives as
 * core's own source, and the words are `readPanel`, which arrives as this
 * package's. This part reads three controls, hands them over, and writes what
 * comes back into text nodes — so a bug that this compiler cannot see is a bug
 * about wiring rather than about selection.
 *
 * Two rules hold the file's other guarantees, and both are checked in
 * `self-contained.test.ts` rather than left to a reader:
 *
 * - It reaches the network in no way at all. No `fetch`, no image, no import.
 * - It writes text and never markup. `textContent` and `value` only — no
 *   `innerHTML`, no `createElement`, no `setAttribute` — so nothing off the
 *   page can become an element or an attribute after the document has loaded.
 */
const WIRING = `(function () {
  const wire = (section, panel) => {
    const sizes = section.querySelector('.sizes-input');
    const viewport = section.querySelector('.viewport-input');
    const ratio = section.querySelector('.dpr-input');
    if (!sizes || !viewport || !ratio) return;

    const marks = section.querySelectorAll('.mark');
    const write = (selector, text) => {
      const node = section.querySelector(selector);
      if (node) node.textContent = text;
    };
    const show = (readout) => {
      write('.clause', readout.clause);
      write('.css', readout.cssPx);
      write('.needed', readout.needed);
      write('.picked', readout.picked);
      write('.reason', readout.reason);
      for (let m = 0; m < marks.length; m++) {
        marks[m].textContent = readout.marks[m] || '';
      }
    };
    const recompute = () => {
      const width = Number(viewport.value);
      const dpr = Number(ratio.value);
      if (!(width > 0) || !(dpr > 0)) {
        show({
          clause: '—',
          cssPx: '—',
          needed: '—',
          picked: '—',
          reason:
            'A viewport width and a device pixel ratio decide this, ' +
            'and both have to be above zero.',
          marks: [],
        });
        return;
      }
      const image = Object.assign({}, panel.image, {
        sizes: sizes.value === '' ? null : sizes.value,
      });
      const device = {
        id: 'typed',
        name: 'typed',
        viewport: { width: width, height: panel.device.viewport.height },
        dpr: dpr,
      };
      show(readPanel(explainSelection(image, device), image.candidates, dpr));
    };

    sizes.value = panel.image.sizes === null ? '' : panel.image.sizes;
    viewport.value = String(panel.device.viewport.width);
    ratio.value = String(panel.device.dpr);
    sizes.addEventListener('input', recompute);
    viewport.addEventListener('input', recompute);
    ratio.addEventListener('input', recompute);
  };

  const island = document.querySelector('script[type="application/json"]');
  if (island === null) return;
  const panels = JSON.parse(island.textContent).panels;
  const sections = document.querySelectorAll('.panel');

  for (let i = 0; i < panels.length; i++) {
    if (sections[i] && panels[i]) wire(sections[i], panels[i]);
  }
})();`;

/**
 * The one script the report ships: core, this package's readout, and the
 * wiring between them and three controls.
 *
 * Both of the first two arrive as the source of the functions themselves —
 * `String(readPanel)` here, `coreSource()` inside core — so the page runs what
 * the command ran rather than a copy of it. That is the design's whole reason
 * for `core` importing nothing: "a measured result and a hypothetical result
 * use the same call", and here they are the same function.
 *
 * Nothing is interpolated into this that did not come from a module in this
 * repo. The Capture reaches the page as JSON in an element of its own, which
 * `dataScript` writes and the wiring above reads, so the rule the stylesheet
 * has always kept holds here too: no page string is ever inside a `<script>`
 * as script.
 */
export const SCRIPT: Html = script(
  [coreSource(), `const readPanel = ${String(readPanel)};`, WIRING].join('\n\n'),
);
