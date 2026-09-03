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
 * reach, which is the whole reason the click is three steps. The two things
 * this function does decide are where a node goes and whether a listener
 * fires, which is the whole of what a renderer is for.
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
  //
  // It is also what makes the whole of the pointing half removable. Every node
  // below and every listener on one of them hangs off this root, so the
  // closing click's single `remove()` takes the marks and the handlers with it
  // — there is no listener anywhere on a page element, and nothing to
  // remember to unregister.
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
  // written to an element, and `privacy.test.ts` keeps this package's list of
  // written properties as short as the panel can be built with. Semantic
  // elements cost nothing and are the reason that list holds no class name.
  //
  // The palette, the type scale and the two font stacks are the report's.
  // `report/src/style.ts` already has a visual language for this data — a
  // muted label column, ink figures, monospace for anything that is an
  // address or a descriptor — and a second dialect for the same numbers would
  // read as a second tool. What is not the report's is the size: this is an
  // instrument sitting on somebody's page, so it is 480px, bottom-right, and
  // it collapses.
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
      width: 480px !important;
      max-width: calc(100vw - 32px) !important;
      max-height: calc(100vh - 32px) !important;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      font-size: 12px !important;
      line-height: 1.5 !important;
      color: #17181a !important;
    }

    /*
     * The card, and the panel's one scroller.
     *
     * One rather than two, and bounded here rather than on the list, because
     * the version this replaced was clipped: it bounded the card and let a
     * flex child hold its content's height, and a flex item's default
     * \`min-height: auto\` refuses to shrink below that. So the list grew past
     * the card, the card was anchored at the bottom of the viewport, and the
     * overflow went off the top of the screen where no scrollbar could reach
     * it. A reader with twenty-three images could see one row of one image.
     *
     * \`overflow-y: auto\` on the element that carries the bound cannot fail
     * that way. Whatever the content, the last thing that happens is a
     * scrollbar. \`scroll-padding-block\` is what keeps a row that was scrolled
     * to by the keyboard clear of the rounded edges.
     */
    section {
      box-sizing: border-box;
      position: relative;
      z-index: 1;
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      overscroll-behavior: contain;
      scroll-padding-block: 12px;
      background: #ffffff;
      border: 1px solid #d7dae0;
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(23, 24, 26, 0.16);
    }

    /* The page-level summary, which is also the handle that collapses the panel. */
    section > details > summary {
      padding: 10px 12px;
      border-bottom: 1px solid #d7dae0;
    }
    h1 {
      display: inline;
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      color: #17181a;
    }
    section > details > summary p {
      margin: 2px 0 0;
      color: #5c6066;
      font-variant-numeric: tabular-nums;
    }

    ol {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      padding: 8px 12px;
      border-top: 1px solid #d7dae0;
    }
    li:first-child {
      border-top: 0;
    }
    /*
     * The row answers a pointer and a keyboard the same way, which is the
     * criterion rather than a nicety: an affordance only a mouse can reach is
     * an affordance half the readers do not have. \`:focus-within\` is what
     * makes the row light up for the button inside it.
     */
    li:hover,
    li:focus-within {
      background: #f4f5f7;
    }

    /* Thumbnail in one column, name and gist stacked in the other. */
    header {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 1px 10px;
      align-items: start;
    }
    img {
      grid-row: span 2;
      box-sizing: border-box;
      width: 44px;
      height: 44px;
      overflow: hidden;
      object-fit: contain;
      background: #f4f5f7;
      border: 1px solid #d7dae0;
      border-radius: 4px;
      color: #5c6066;
      font-size: 8px;
      line-height: 1.15;
    }
    h2 {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
    }
    /*
     * The name is a button because activating it does something: it brings the
     * image it names into view. \`all: initial\` on the host does not reach a
     * descendant's own UA styles, so the whole of a button's chrome is undone
     * here by hand — and \`text-align: left\` matters, since a centred file
     * name in a column of left-aligned ones reads as a different kind of
     * thing.
     */
    button {
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-height: 24px;
      margin: 0;
      padding: 1px 0;
      border: 0;
      background: none;
      color: #17181a;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.4;
      text-align: left;
      overflow-wrap: anywhere;
      cursor: pointer;
    }
    button:hover {
      color: #6b21a8;
    }
    header p {
      margin: 0;
      color: #5c6066;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      overflow-wrap: anywhere;
    }

    /*
     * The mark, and the one word in the panel that carries its own
     * explanation. \`mark\` is the element the platform already has for a figure
     * flagged for reference, so the flag needs no class of its own — and its
     * \`title\` is the mark's meaning, reachable from the mark. The same
     * reasoning is written out in the row's own note, because a tooltip is a
     * hover affordance and cannot be the only copy of anything.
     */
    mark {
      margin-left: 6px;
      padding: 0 4px;
      border-radius: 3px;
      background: #f3e8ff;
      color: #6b21a8;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 10px;
      letter-spacing: 0.04em;
      cursor: help;
    }

    /* The arithmetic, which opens. Indented to the column the name starts in. */
    li details {
      margin: 6px 0 0 54px;
    }
    summary {
      min-height: 24px;
      padding: 2px 0;
      color: #5c6066;
      font-size: 11px;
      cursor: pointer;
    }
    button:focus-visible,
    summary:focus-visible {
      outline: 2px solid #7e22ce;
      outline-offset: 2px;
    }

    dl {
      display: grid;
      grid-template-columns: 86px minmax(0, 1fr);
      margin: 4px 0 0;
      column-gap: 10px;
      row-gap: 2px;
    }
    dt {
      color: #5c6066;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
      font-variant-numeric: tabular-nums;
    }
    /*
     * The second grid in a row is the addresses, whole and uncut, and it is
     * separated from the arithmetic rather than continuing it — the figures
     * above are compared down a column and these are read one at a time. The
     * adjacent-sibling selector is what says so without a class name.
     */
    dl + dl {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed #d7dae0;
    }
    dl + dl dt,
    dl + dl dd {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
    }
    dl + dl dd {
      color: #5c6066;
    }

    li details p {
      margin: 8px 0 0;
      max-width: 62ch;
      color: #5c6066;
      line-height: 1.55;
    }

    footer {
      padding: 8px 12px 10px;
      border-top: 1px solid #d7dae0;
      background: #f4f5f7;
    }
    footer p {
      margin: 8px 0 0;
      max-width: 62ch;
      color: #5c6066;
      font-size: 11px;
      line-height: 1.55;
    }

    /*
     * The marked box, drawn by the extension over the image a row describes.
     *
     * The extension's own element, positioned from the image's own rect, and
     * that is the constraint rather than an implementation detail: a panel
     * that wrote an outline onto the page's element would have restyled the
     * thing it was measuring, and a restyled element can lay out at a
     * different width — which is an input to the arithmetic the panel is
     * showing. So nothing is written to a page element at all.
     *
     * \`position: fixed\` resolves against the viewport, which is the same
     * coordinate space \`getBoundingClientRect\` reports in, so the numbers go
     * straight in with no scroll offset to add. Nothing on \`:host\` makes a
     * containing block — \`all: initial !important\` resets \`transform\`,
     * \`filter\` and \`contain\` along with everything else, so no page rule can
     * make one either — and \`pointer-events: none\` keeps the box from taking a
     * click the page was meant to get.
     *
     * Hidden by default and positioned by the second stylesheet below.
     */
    div {
      position: fixed;
      display: none;
      box-sizing: border-box;
      border: 2px solid #7e22ce;
      border-radius: 2px;
      background: rgba(126, 34, 206, 0.14);
      pointer-events: none;
    }
  `;
  root.appendChild(style);

  /**
   * Where the marked box is, as a stylesheet the panel rewrites.
   *
   * A second `<style>` rather than an inline style on the box, and the reason
   * is the list in `privacy.test.ts`: writing a property is how a panel would
   * leak a page without calling anything, so the list of properties this
   * package writes is kept as short as the panel can be built with. Four
   * geometry properties on an element's `style` would be four more names on
   * it. The words a `<style>` element says are `textContent`, which the panel
   * already writes on every label and every figure, so a rule rewritten here
   * costs the list nothing at all.
   *
   * Appended after the sheet above so that its `div` rule wins on order,
   * which is what lets an empty sheet mean "no box".
   */
  const frame = document.createElement('style');
  root.appendChild(frame);

  const spot = document.createElement('div');
  root.appendChild(spot);

  /**
   * The image a row is about, or nothing where the page has moved on.
   *
   * `read.ts` argues the handle: `readPage` walks `document.images` and hands
   * each row its index into that collection, so the panel indexes the same
   * live collection back. A page that inserted or removed an `<img>` between
   * the read and the hover has shifted it — a row past the new end finds
   * nothing, which is this guard, and a row before it can find the neighbour
   * of the image it names, which is not corrected. The panel is one render's
   * answer; a page that has moved on wants a second click.
   */
  const imageAt = (at: number): HTMLImageElement | undefined => document.images[at];

  /** Draw the box over one image, or draw nothing if it is not there. */
  const mark = (at: number): void => {
    const image = imageAt(at);
    if (image === undefined) {
      frame.textContent = '';
      return;
    }
    // Rounded because a rect is fractional and a border drawn on a half pixel
    // is a border a browser antialiases into two grey ones. An image the page
    // draws no box for — `display: none`, or nothing loaded and no size given
    // — has a rect of zero, so the box is invisible; the row's `rendered box`
    // line is what says why, rather than a mark that silently does nothing.
    const box = image.getBoundingClientRect();
    frame.textContent =
      `div { display: block; top: ${Math.round(box.top)}px; left: ${Math.round(box.left)}px; ` +
      `width: ${Math.round(box.width)}px; height: ${Math.round(box.height)}px }`;
  };

  /** Take the box away, which is what leaving a row means. */
  const unmark = (): void => {
    frame.textContent = '';
  };

  const section = document.createElement('section');

  /**
   * The panel, as a disclosure.
   *
   * `details` rather than a button and a flag, because the platform already
   * has the widget: it opens and closes on a click, on Enter and on Space,
   * it tells assistive technology what state it is in, and it needs no
   * listener and no state of its own. `open` is the one property write the
   * arrangement costs.
   */
  const card = document.createElement('details');
  card.open = true;

  const heading = document.createElement('summary');

  const title = document.createElement('h1');
  title.textContent = 'imgwhy';
  heading.appendChild(title);

  // Every word the page supplied arrives through `textContent`, and that is
  // the whole of the escaping story. Nothing here builds markup from a string,
  // so a selector, a `sizes` attribute, a descriptor or a candidate URL cannot
  // be reinterpreted as a tag however the page wrote it — there is no parser
  // in the path to reinterpret it. `escaping.test.ts` holds that as behaviour
  // and refuses the properties that would undo it.
  const head = document.createElement('p');
  head.textContent = panel.head;
  heading.appendChild(head);
  card.appendChild(heading);

  const list = document.createElement('ol');

  for (const row of panel.rows) {
    const item = document.createElement('li');

    const top = document.createElement('header');

    /**
     * The thumbnail, which is the most direct identification there is.
     *
     * The one value this package ever assigns to a `src`, and it is the whole
     * of `row.file` — the `currentSrc` the reading took off the page's own
     * image, passed through every step untouched. Nothing is concatenated onto
     * it and nothing is interpolated into it, which is what keeps the request
     * from carrying a fact about the page: the browser asks for a file it has
     * already asked for, from a host it has already contacted, and usually
     * answers out of its own cache without a request at all.
     * `privacy.test.ts` holds that shape rather than trusting it.
     *
     * An image that has loaded nothing gets no `src`, so the browser is never
     * pointed at an empty URL — which resolves to the page itself and would be
     * a request for the document. It shows its `alt` instead, and so does a
     * `src` that fails: `explain.ts` words that string so a box that will not
     * draw still says which image it was.
     */
    const thumb = document.createElement('img');
    thumb.alt = row.alt;
    if (row.file !== '') thumb.src = row.file;
    top.appendChild(thumb);

    const named = document.createElement('h2');
    const name = document.createElement('button');
    name.textContent = row.name;
    named.appendChild(name);
    top.appendChild(named);

    const gist = document.createElement('p');
    gist.textContent = row.gist;
    // The mark's word, then the mark. `textContent` removes every existing
    // child, so the order is load-bearing: written after the append it would
    // delete the flag and leave the footer's sentence pointing at nothing.
    const flag = document.createElement('mark');
    flag.textContent = 'cache';
    flag.title = row.mark;
    gist.appendChild(flag);
    top.appendChild(gist);

    item.appendChild(top);

    /**
     * The arithmetic, which opens.
     *
     * Closed by default, and that is the layout decision the maintainer's
     * screenshot forced. Twenty-three images each standing eight figures, a
     * DOM path and four paragraphs tall is a panel four times more prose than
     * data, taller than any screen, with one row of one image visible. Every
     * word of it is still here — nothing was cut, only moved behind the
     * summary a reader opens for the row they are actually asking about.
     */
    const more = document.createElement('details');
    const opens = document.createElement('summary');
    opens.textContent = 'arithmetic, files and where it sat';
    more.appendChild(opens);

    const fields = document.createElement('dl');
    for (const line of row.lines) {
      const label = document.createElement('dt');
      label.textContent = line.label;
      fields.appendChild(label);

      const value = document.createElement('dd');
      value.textContent = line.value;
      // The design's requirement, as an element rather than a sentence: a
      // figure the cache could have contaminated is marked where it is shown,
      // and the footer says once what the mark means.
      if (line.held) {
        const held = document.createElement('mark');
        held.textContent = 'cache';
        held.title = row.mark;
        value.appendChild(held);
      }
      fields.appendChild(value);
    }
    more.appendChild(fields);

    // The addresses, whole. The `loaded` and `picked` lines above are cut to
    // fit a column, and a cut URL is a URL two files can share — which is
    // exactly the reading a row whose own note says they disagree cannot
    // survive. These are uncut and selectable, so a difference in a directory
    // is a difference a reader can see and copy.
    if (row.sources.length > 0) {
      const files = document.createElement('dl');
      for (const source of row.sources) {
        const label = document.createElement('dt');
        label.textContent = source.label;
        files.appendChild(label);

        const value = document.createElement('dd');
        value.textContent = source.url;
        files.appendChild(value);
      }
      more.appendChild(files);
    }

    for (const note of row.notes) {
      const said = document.createElement('p');
      said.textContent = note;
      more.appendChild(said);
    }

    item.appendChild(more);

    /**
     * Pointing at the image, which is what settles which row is which.
     *
     * Four listeners on the row and one on its button, all of them on nodes
     * inside this closed root. Not one is on a page element, which is why the
     * closing click's single `remove()` is the whole of the cleanup: there is
     * nothing left to unregister and nothing on the page that outlives the
     * panel.
     *
     * `mouseenter` and `mouseleave` rather than `mouseover` and `mouseout`,
     * because the pair that does not bubble is the pair that means what it
     * says here — a `mouseover` on a child of the row would re-fire on every
     * label a pointer crossed. `focusin` and `focusout` rather than `focus`
     * and `blur` for the mirror-image reason: those two do not bubble, and the
     * thing that takes focus is the button inside the row rather than the row.
     * A keyboard reader gets exactly what a pointer reader gets, which is the
     * criterion.
     */
    item.addEventListener('mouseenter', () => mark(row.at));
    item.addEventListener('mouseleave', unmark);
    item.addEventListener('focusin', () => mark(row.at));
    item.addEventListener('focusout', unmark);

    /**
     * Activating the name brings the image into view.
     *
     * On the button rather than on the row, so that opening the arithmetic
     * does not also scroll the page — two controls, one job each. The button
     * answers Enter and Space with a click of its own, so there is no key
     * handler here and no key this panel has taught anybody.
     *
     * `behavior: 'instant'` rather than the default, and it is not a
     * preference. A page with `scroll-behavior: smooth` in its own stylesheet
     * animates the scroll, and the rect read on the next line would then be
     * the box's position before the animation — a mark drawn where the image
     * used to be. Scroll position is the one thing about the page a click here
     * changes, and it changes it because the criterion asks for it.
     */
    name.addEventListener('click', () => {
      const image = imageAt(row.at);
      if (image === undefined) return;
      image.scrollIntoView({ block: 'center', behavior: 'instant' });
      mark(row.at);
    });

    list.appendChild(item);
  }
  card.appendChild(list);

  /**
   * What the extension cannot do, behind one line.
   *
   * The three sentences are the design's and every word of them is kept. What
   * changed is that they no longer stand between a reader and the data: three
   * paragraphs at the same size and weight as the figures made the panel read
   * as documentation with numbers in it. Closed by default, opened once by
   * whoever wants the argument.
   */
  const footer = document.createElement('footer');
  const limits = document.createElement('details');
  const asks = document.createElement('summary');
  asks.textContent = 'What a mark means, and why bytes are unknown';
  limits.appendChild(asks);
  for (const line of panel.footer) {
    const said = document.createElement('p');
    said.textContent = line;
    limits.appendChild(said);
  }
  footer.appendChild(limits);
  card.appendChild(footer);

  section.appendChild(card);
  root.appendChild(section);

  // The document element rather than the body. `position: fixed` resolves
  // against the nearest ancestor that established a containing block, and a
  // `transform`, `filter` or `perspective` on `body` makes one — so a page
  // that animates its body would drag the panel along with it. `html` can do
  // the same and almost never does.
  document.documentElement.appendChild(host);

  return 'opened';
}
