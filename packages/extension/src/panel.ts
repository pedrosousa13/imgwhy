import type { Panel } from './explain.js';

/**
 * The panel, and the one function a click sends into the page second.
 *
 * Everything below is inside `renderPanel`, including the strings and the
 * stylesheet, and that is a requirement rather than a style. `executeScript`
 * does not send the function: it sends `String(func)` and the page evaluates
 * that text. A constant declared beside the function, a helper it called, an
 * import it named are all gone by the time the text runs, and every one of
 * them is a `ReferenceError` in someone's browser. `panel.test.ts` runs the
 * text in a context holding a `document` and nothing else, which is the only
 * arrangement that can catch it.
 *
 * The `import type` above is the one exception, and it is not an exception at
 * all: a type is erased before `tsc` emits anything, so `dist/panel.js` holds
 * one function declaration and no import statement. What it buys is the shape
 * of the argument being checked at the seam rather than described in a
 * comment — `explain.ts` builds a `Panel` and this takes one, so a field added
 * to one and not read by the other fails to compile.
 *
 * The other consequence is that this module has no top level worth speaking
 * of: one function declaration, no runtime imports, no constants.
 * `dormant.test.ts` asks for that of every module here, because the worker
 * imports this one and an effect at its top level would run when the worker
 * wakes.
 *
 * Nothing here decides anything either. Every figure the panel shows arrives
 * in `panel`, already worded by `explain.ts`, which asked core. A renderer
 * that computed a number would be arithmetic in the one place core cannot
 * reach, which is the whole reason the click is three steps.
 */

/**
 * Put the panel in the page, with the arithmetic already worked out.
 *
 * `readPage` is what takes it away again: the closing click never gets this
 * far, because the state is the page and the page is what answers. So there is
 * one return value here, and it is the one the worker never reads — the panel
 * appearing is the report.
 */
export function renderPanel(panel: Panel): 'opened' {
  // Underscored and prefixed, because it lands in the page's id namespace and
  // has to not collide with anything a site happens to have called its own.
  // Declared twice, here and in `read.ts`, because neither copy can see the
  // other: a shared constant is exactly the kind of name that does not come
  // over with a stringified function.
  const HOST_ID = '__imgwhy_host__';

  const host = document.createElement('div');
  host.id = HOST_ID;

  // A closed root rather than an open one. Open would leave every node the
  // panel makes one property access away — `document.getElementById(id)
  // .shadowRoot.querySelector(…)` — which is a page reading and rewriting a
  // panel it was never given. Closed returns the root to this function and to
  // nothing else, so the only way in is the reference held here.
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');

  // The whole of the isolation is in the `:host` rule, and the two things that
  // make it hold are `all: initial` and the importance on every line.
  //
  // CSS Cascade 4 sorts declarations by origin and importance, then by
  // encapsulation context — and the context rule reverses with importance:
  // for normal declarations the outer tree wins, and for important ones the
  // inner tree does. The page is the outer tree here. So a normal `:host`
  // rule would lose to any page rule at all, and an important one beats even
  // an important page rule and an important `style` attribute the page sets
  // on the host, because context is sorted before element-attached styles.
  // That is why nothing here is written inline: it would add a second place
  // to keep the same list without winning anything the `:host` rule has not
  // already won.
  //
  // `all: initial` comes first and is what defends the properties nobody
  // thought to list. A page that sets `letter-spacing: 3em !important` on the
  // host would otherwise have it inherit straight through the boundary, since
  // inheritance is the one thing a shadow root does not stop. Writing it last
  // would reset the declarations above it, so the order is load-bearing and
  // `panel.test.ts` checks it.
  //
  // `all` is not quite every property, and the exceptions are why `direction`
  // and `unicode-bidi` are declared below. The spec leaves both out of the
  // shorthand — resetting them breaks bidirectional text in ways an author
  // almost never means — so `all: initial` does not touch either one, and a
  // page setting `direction: rtl !important` on the host mirrors the whole
  // panel. Declaring them by name is the only thing that stops it. Custom
  // properties are the third exception and the one that cannot be closed this
  // way, since there is no finite list of them to declare: nothing here reads
  // a `var()`, and the test refuses one so nothing starts to.
  //
  // Rules for the panel's own elements need none of this. A page selector
  // cannot match a node in a shadow tree, so the only route in was
  // inheritance and the `:host` rule has already closed it. They select on
  // tag names alone, which is not a shortcut: a class name is a property
  // written to an element, and `privacy.test.ts` allows this package two
  // written properties — an id and the words it says. Semantic elements cost
  // nothing and keep that list at two.
  style.textContent = `
    :host {
      all: initial !important;
      direction: ltr !important;
      unicode-bidi: isolate !important;
      position: fixed !important;
      right: 16px !important;
      bottom: 16px !important;
      z-index: 2147483647 !important;
      display: block !important;
      width: 440px !important;
      max-width: calc(100vw - 32px) !important;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif !important;
      font-size: 12px !important;
      line-height: 1.5 !important;
      color: #16181d !important;
    }
    section {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      max-height: min(74vh, 760px);
      padding: 12px 14px;
      background: #ffffff;
      border: 1px solid #d5d8de;
      border-radius: 8px;
      box-shadow: 0 6px 24px rgba(16, 18, 22, 0.18);
    }
    h1 {
      margin: 0;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #767d8a;
    }
    h1 + p {
      margin: 2px 0 0;
      font-variant-numeric: tabular-nums;
    }
    ol {
      flex: 1 1 auto;
      overflow: auto;
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
    }
    li {
      padding: 8px 0;
      border-top: 1px solid #e6e8ec;
    }
    h2 {
      margin: 0 0 4px;
      font-size: 11px;
      font-weight: 600;
      color: #545a66;
      overflow-wrap: anywhere;
    }
    dl {
      display: grid;
      grid-template-columns: 78px minmax(0, 1fr);
      margin: 0;
      column-gap: 10px;
      row-gap: 1px;
    }
    dt {
      color: #767d8a;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
      font-variant-numeric: tabular-nums;
    }
    mark {
      margin-left: 6px;
      padding: 0 4px;
      border-radius: 3px;
      background: #f1e7fd;
      color: #6b21a8;
      font-size: 10px;
      letter-spacing: 0.04em;
    }
    li p {
      margin: 6px 0 0;
      color: #8a3b12;
    }
    footer {
      margin: 8px 0 0;
      padding-top: 8px;
      border-top: 1px solid #e6e8ec;
    }
    footer p {
      margin: 0;
      color: #767d8a;
      font-size: 11px;
    }
    footer p + p {
      margin-top: 4px;
    }
  `;
  root.appendChild(style);

  const section = document.createElement('section');

  const title = document.createElement('h1');
  title.textContent = 'imgwhy';
  section.appendChild(title);

  // Every word the page supplied arrives through `textContent`, and that is
  // the whole of the escaping story. Nothing here builds markup from a string,
  // so a selector, a `sizes` attribute, a descriptor or a candidate URL cannot
  // be reinterpreted as a tag however the page wrote it — there is no parser
  // in the path to reinterpret it. `escaping.test.ts` holds that as behaviour
  // and refuses the properties that would undo it.
  const head = document.createElement('p');
  head.textContent = panel.head;
  section.appendChild(head);

  const list = document.createElement('ol');

  for (const row of panel.rows) {
    const item = document.createElement('li');

    const heading = document.createElement('h2');
    heading.textContent = row.heading;
    item.appendChild(heading);

    const fields = document.createElement('dl');
    for (const line of row.lines) {
      const label = document.createElement('dt');
      label.textContent = line.label;
      fields.appendChild(label);

      const value = document.createElement('dd');
      value.textContent = line.value;
      // The design's requirement, as an element rather than a sentence: a
      // figure the cache could have contaminated is marked where it is shown,
      // and the footer says once what the mark means. `mark` is the element
      // the platform already has for a figure flagged for reference, so the
      // flag needs no class of its own.
      if (line.held) {
        const flag = document.createElement('mark');
        flag.textContent = 'cache';
        value.appendChild(flag);
      }
      fields.appendChild(value);
    }
    item.appendChild(fields);

    for (const note of row.notes) {
      const said = document.createElement('p');
      said.textContent = note;
      item.appendChild(said);
    }

    list.appendChild(item);
  }
  section.appendChild(list);

  const footer = document.createElement('footer');
  for (const line of panel.footer) {
    const said = document.createElement('p');
    said.textContent = line;
    footer.appendChild(said);
  }
  section.appendChild(footer);

  root.appendChild(section);

  // The document element rather than the body. `position: fixed` resolves
  // against the nearest ancestor that established a containing block, and a
  // `transform`, `filter` or `perspective` on `body` makes one — so a page
  // that animates its body would drag the panel along with it. `html` can do
  // the same and almost never does.
  document.documentElement.appendChild(host);

  return 'opened';
}
