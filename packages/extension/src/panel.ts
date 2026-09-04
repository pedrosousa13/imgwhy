import type { Line, Panel, Row } from './explain.js';
import type { Reading } from './read.js';

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
export function renderPanel(panel: Panel, reading: Reading): 'opened' {
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
  // It is also what makes almost the whole of the pointing half removable.
  // Every node below and every listener on one of them hangs off this root, so
  // the closing click's single `remove()` takes the marks and the row handlers
  // with it, and no page element carries one. The exception is the two
  // listeners on the window that keep a mark on its image while the viewport
  // moves: those are not on a node at all, so they are added when a mark goes
  // up, removed when it comes down, and removed again on `CLOSING` for the
  // case where the panel is closed with a mark still showing.
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
  // tag names, with one exception: the verdict carries one of three tone
  // classes, because a tone is a state and not a kind of element, and the
  // three words are the extension's own. `privacy.test.ts` keeps this
  // package's list of written properties as short as the panel can be built
  // with, and that class is the one it costs.
  //
  // The palette and the two font stacks are the report's. `report/src/style.ts`
  // already has a visual language for this data — a muted label column, ink
  // figures, monospace for anything that is an address or a descriptor — and a
  // second dialect for the same numbers would read as a second tool. What is
  // not the report's is the size and the emphasis: this is an instrument
  // sitting on somebody's page, so it is 480px, bottom-right, and it
  // collapses; and on every row one token is the answer — the descriptor of
  // the file that loaded — so that token is the largest thing on the row and
  // everything else is set to recede from it.
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

    /*
     * The head: the title, the count, and the two inputs.
     *
     * The viewport width and the ratio are the two numbers that explain every
     * row below, so they are set as a pair of read-only fields — a small label
     * over a figure — rather than as a line of metadata. Every sentence in the
     * panel names them again, and this is where a reader checks them.
     */
    section > details > summary {
      padding: 10px 12px 9px;
      border-bottom: 1px solid #d7dae0;
      cursor: pointer;
    }
    h1 {
      display: inline;
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      color: #17181a;
    }
    section > details > summary > p {
      display: inline;
      margin: 0 0 0 8px;
      color: #5c6066;
      font-variant-numeric: tabular-nums;
    }
    /*
     * The way out, at the end of the line the panel opens with.
     *
     * Underlined and in the panel's one accent, the same as the control that
     * re-orders the list, because they are the same kind of thing: a word that
     * does something when a reader asks it to. Floated to the right of the
     * heading so it sits where a reader of any panel looks for it, and out of
     * the way of the counts, which are the sentence the heading is for.
     */
    section > details > summary > button {
      float: right;
      color: #6b21a8;
      font-size: 11px;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    section > details > summary > button:hover {
      color: #7e22ce;
    }
    section > details > summary > dl {
      display: grid;
      grid-template-columns: auto auto;
      justify-content: start;
      column-gap: 24px;
      margin: 6px 0 0;
    }
    section > details > summary dt {
      grid-row: 1;
      color: #5c6066;
      font-size: 10px;
      line-height: 1.4;
    }
    section > details > summary dd {
      grid-row: 2;
      margin: 0;
      color: #17181a;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
      font-variant-numeric: tabular-nums;
    }

    /*
     * The order the list is in, and the control that changes it.
     *
     * The words say which order is showing rather than leaving a reader to
     * work it out from the rows, because a list whose order is a mystery is
     * worse than either order. They sit in the scroller above the first row
     * and below the head, which is where the list begins.
     *
     * Outside the summary above, which is the arrangement rather than a
     * detail: a button inside a summary is a control inside a control, so a
     * click meant to re-order the list would toggle the disclosure holding it
     * and collapse the panel. Two siblings cannot do that to each other.
     *
     * The control is set as a link rather than as a chip — underlined, in the
     * one accent this panel has — because everything around it is a figure or
     * a label, and the one thing on the line that does something has to look
     * unlike them.
     */
    section > details > p {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin: 0;
      padding: 5px 12px 4px;
      border-bottom: 1px solid #d7dae0;
      color: #5c6066;
      font-size: 11px;
    }
    section > details > p > button {
      color: #6b21a8;
      font-size: 11px;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    section > details > p > button:hover {
      color: #7e22ce;
    }

    ol {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      padding: 9px 12px 8px;
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

    /* Thumbnail in one column; heading and sentence stacked in the other. */
    header {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 2px 10px;
      align-items: start;
    }

    /*
     * The thumbnail, which fills its box rather than fitting inside it.
     *
     * \`contain\` was the blank-thumbnail bug. A 568×152 banner fitted inside a
     * 44px square is a strip 12px tall, and a 1763×393 one is 10px, and on a
     * light ground a strip of a mostly-light banner is nothing at all. \`cover\`
     * crops instead, so a wide or a tall image shows a recognisable piece of
     * itself at full height. The box stays small; it is an identifier.
     *
     * The ground is checked, so a transparent image reads as transparent
     * rather than as missing — drawn with a gradient, because a stylesheet
     * that loaded an image would be a request this extension does not make.
     *
     * It is a mid tone rather than the light one an image editor uses, and
     * that is the second blank-thumbnail bug rather than a preference. The
     * editor convention assumes the artwork is dark; a page's own artwork
     * often is not. A transparent banner whose only content is white type —
     * two of them on the page this was found on — had nothing to contrast
     * against on a white-and-light-grey check and drew as an empty box: the
     * request succeeded, the thumbnail was there, and the reader saw nothing.
     * A tool that explains other people's pages meets white logos constantly,
     * so the ground has to answer light content and dark content both, and
     * only a middle tone does. The stylesheet test holds every tone here
     * inside a middle band, so a later palette cannot quietly take it back.
     */
    img {
      grid-row: span 2;
      box-sizing: border-box;
      width: 44px;
      height: 44px;
      overflow: hidden;
      object-fit: cover;
      background-color: #b9bec6;
      background-image: repeating-conic-gradient(#8d949e 0 25%, #b9bec6 0 50%);
      background-size: 8px 8px;
      border: 1px solid #d7dae0;
      border-radius: 4px;
      color: #5c6066;
      font-size: 8px;
      line-height: 1.15;
    }
    /* The size, where the image is too small for a thumbnail to show anything. */
    header > small {
      grid-row: span 2;
      display: flex;
      box-sizing: border-box;
      width: 44px;
      height: 44px;
      align-items: center;
      justify-content: center;
      background: #f4f5f7;
      border: 1px dashed #d7dae0;
      border-radius: 4px;
      color: #5c6066;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      /*
       * The box holds two words as well as a size now: an image the browser
       * has not fetched says so here rather than drawing an empty frame. Both
       * are short, and both have to stay inside 44 pixels without pushing the
       * heading beside them out of line.
       */
      overflow-wrap: anywhere;
      text-align: center;
      line-height: 1.2;
    }

    /*
     * The heading: verdict, descriptor, name, mark — in that order, and set so
     * the eye lands on them in that order.
     *
     * The verdict is a small tinted word, fixed to one width so the
     * descriptors line up in a column down the panel. The descriptor is the
     * largest type on the row, because it is the answer to the question the
     * reader came with. The name is monospace and dim beside it, there to
     * confirm which image and not to compete.
     */
    h2 {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2px 8px;
      margin: 0;
      font-size: 12px;
      font-weight: 400;
    }
    output {
      display: inline-block;
      box-sizing: border-box;
      min-width: 5.6em;
      padding: 1px 6px 0;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      line-height: 1.6;
      letter-spacing: 0.01em;
      text-align: center;
    }
    output.good {
      background: #e3f3e8;
      color: #1b5e33;
    }
    output.warn {
      background: #fbeccd;
      color: #7a4e00;
    }
    output.quiet {
      background: #eceef1;
      color: #5c6066;
    }
    /*
     * The name is a button because activating it does something: it brings the
     * image it names into view. \`all: initial\` on the host does not reach a
     * descendant's own UA styles, so the whole of a button's chrome is undone
     * here by hand.
     */
    button {
      display: inline-flex;
      align-items: baseline;
      gap: 7px;
      min-width: 0;
      min-height: 24px;
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
      color: #17181a;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    button > code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
      line-height: 1.3;
      white-space: nowrap;
    }
    button > small {
      color: #5c6066;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      font-weight: 400;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    button:hover > code {
      color: #6b21a8;
    }

    /*
     * The one clause, set to recede from the heading and to read in a column.
     *
     * The measure is what makes the row scannable rather than the wording
     * alone, and the panel's own test reads the figure out of this rule and
     * wraps every verdict's longest clause at it: two lines, so a row with its
     * heading is three. A wider column would fit the words and lose the shape.
     */
    header > p {
      margin: 0;
      max-width: 62ch;
      color: #3b3f46;
      font-size: 12px;
      line-height: 1.5;
    }

    /*
     * The mark, and the one word in the panel that carries its own
     * explanation. \`mark\` is the element the platform already has for a figure
     * flagged for reference, so the flag needs no class of its own — and its
     * \`title\` is the mark's meaning, reachable from the mark. The same
     * reasoning is written out in the footer, because a tooltip is a hover
     * affordance and cannot be the only copy of anything.
     */
    mark {
      padding: 0 4px;
      border-radius: 3px;
      background: #f3e8ff;
      color: #6b21a8;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 10px;
      letter-spacing: 0.04em;
      cursor: help;
    }
    dd > mark {
      margin-left: 6px;
    }

    /* The arithmetic, which opens. Indented to the column the heading starts in. */
    li details {
      margin: 4px 0 0 54px;
    }
    li summary {
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

    li dl {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      margin: 4px 0 0;
      column-gap: 10px;
      row-gap: 2px;
    }
    li dt {
      color: #5c6066;
      font-size: 11px;
      line-height: 1.6;
    }
    li dd {
      margin: 0;
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.6;
      font-variant-numeric: tabular-nums;
    }
    /*
     * The second opening is the addresses, whole and uncut, and it is set
     * apart from the steps rather than continuing them — the figures above are
     * compared down a column and these are read one at a time.
     */
    li details details {
      margin: 8px 0 0;
      padding-top: 6px;
      border-top: 1px dashed #d7dae0;
    }
    li details details dd {
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
     * straight in with no scroll offset to add — and it is also why the rect
     * has to be read again when the viewport moves, which is what the two
     * window listeners above are for. Nothing on \`:host\` makes a
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
   * The image a row is about, confirmed, or nothing where the page no longer
   * holds it.
   *
   * The handle is the index into `document.images` the reading minted, and it
   * is the fast path rather than the answer. An `<img>` inserted or removed
   * *before* that index shifts every later row onto a neighbouring element,
   * with nothing anywhere saying so: an infinite-scroll page that lazy-inserts
   * one image above the fold is enough, and the row for the hero then marks
   * the thumbnail above it and scrolls to that instead. A row past the new end
   * was the only case the previous version caught, which is the least likely
   * of them.
   *
   * So the element the index resolves to is confirmed against the file the
   * browser had loaded — `currentSrc`, which the reading already carries as
   * `row.file` and the row already shows as its thumbnail. The selector was the
   * alternative and it is the weaker of the two: it is a string built out of
   * tag names and `nth-of-type` positions, so a page that re-orders siblings
   * resolves it to a different element with no error anywhere, and handing it
   * to `querySelector` would be this package parsing page content.
   *
   * Where the index misses, the same file is looked for across the collection,
   * which is what recovers every row on a page that inserted one image above
   * them. One match is a confirmation; two are two images a reading cannot tell
   * apart, and guessing between them is the failure this exists to stop. Where
   * the index hits it stands, ambiguity and all: a page's twentieth identical
   * avatar is indistinguishable from its nineteenth, and refusing to mark
   * either would be a worse panel than one that marks the element the index
   * names.
   *
   * A row that recorded no file has nothing to be found by. The index is
   * confirmed only as far as "the image here has still loaded nothing", and a
   * lazy image that finished loading in between fails that — which is the
   * honest outcome, because a row whose verdict, thumbnail and sentence are all
   * about a file that has since arrived is a row describing something else.
   */
  const imageFor = (row: Row): HTMLImageElement | undefined => {
    /**
     * Whether one element is the image this row describes.
     *
     * `currentSrc` against `row.file`, and nothing else on either side. The
     * property was on this line and it made the paragraph below false for every
     * lazy image on the page: a row that recorded no file was compared against
     * an `img.src` reflecting the attribute, so the comparison was a URL
     * against the empty string, the handle never confirmed, and the ordinary
     * image below the fold got `not found` and no mark — which is the failure
     * the word exists to report rather than to cause. Both sides are the file
     * the browser loaded now, so "the image here has still loaded nothing" is a
     * thing this can actually say.
     */
    const describes = (image: HTMLImageElement | undefined): boolean =>
      image !== undefined && image.currentSrc === row.file;

    const at = document.images[row.at];
    if (describes(at)) return at;
    if (row.file === '') return undefined;

    const same = [...document.images].filter(describes);
    return same.length === 1 ? same[0] : undefined;
  };

  /**
   * The row a mark is up for, as the closure that draws it again.
   *
   * A closure rather than the row, because what a scroll needs is not a number
   * but the whole of "draw this row's box again" — the row and the heading the
   * word below goes on.
   */
  let held: (() => void) | null = null;

  /** The word one row is carrying about its own handle, or nothing. */
  let lost: Element | null = null;

  /** Draw the box over one row's image, or say the row cannot find it. */
  const place = (row: Row, named: Element): void => {
    const image = imageFor(row);
    if (image === undefined) {
      // Criterion 5, and the claim #22's commit message made and did not keep:
      // a row that cannot find its image says so rather than marking a
      // neighbour. A `mark` beside the one that says a held copy could explain
      // the figures, because both are a figure flagged for reference and the
      // platform has an element for that. Its `title` says what to do about it.
      frame.textContent = '';
      // One word at a time, on the row it is about. The heading is checked as
      // well as the word's existence because a pointer can be on one row while
      // a keyboard takes focus to another, and a word left on the row the
      // pointer has moved off is a word on the wrong row.
      if (lost === null || lost.parentElement !== named) {
        lost?.remove();
        const word = document.createElement('mark');
        word.textContent = 'not found';
        word.title =
          'this image is no longer on the page as the reading found it, so there is nothing to ' +
          'mark; close the panel and click again for a reading of the page as it is now';
        named.appendChild(word);
        lost = word;
      }
      return;
    }

    lost?.remove();
    lost = null;
    // Read again on every call rather than once, because a rect is a
    // measurement of one moment: a scroll, a resize, a lazy ad slot or a late
    // web font moves the box, and coordinates written into the sheet once are
    // a box over blank space from then on.
    //
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

  /** Read the box again, wherever the viewport has moved it to. */
  const follow = (): void => {
    if (held !== null) held();
  };

  /**
   * Take the box away, which is what leaving a row means — and take down every
   * listener the box needed.
   *
   * The same function answers the closing click, because the panel being taken
   * away and the pointer leaving a row want exactly the same thing done.
   */
  const unmark = (): void => {
    held = null;
    frame.textContent = '';
    lost?.remove();
    lost = null;
    window.removeEventListener('scroll', follow);
    window.removeEventListener('resize', follow);
    window.removeEventListener('__imgwhy_closing__', unmark);
  };

  /**
   * Put the box on one row's image, and keep it there while it is up.
   *
   * `scroll` and `resize` are the two events the platform gives for free that
   * mean the box may have moved, and they are the whole of the tracking. A
   * `ResizeObserver` or a `MutationObserver` on the page's own element would
   * catch the layout shifts that fire neither — and would be a reach into the
   * page for a box that is already re-read on every signal there is, so
   * neither is here. Nor is a loop that polls, which is a cost every frame for
   * an answer that changes on an event.
   *
   * Registering the same function for the same event again is a no-op in a
   * browser, so moving from row to row costs nothing and there is nothing to
   * count.
   *
   * The third is the closing click, which is the one listener here that is not
   * about geometry: removing the host takes every listener on a node with it
   * and takes nothing off the window, so `read.ts` fires `__imgwhy_closing__`
   * before it removes the host and this is what hears it. The name is written
   * out at both registrations rather than held in a constant, because
   * `dormant.test.ts` reads the event a listener is registered for and refuses
   * one it cannot see — a listener for a name computed at run time is a
   * listener no check can hold to the list of events that fire without a
   * click. `read.ts` spells the same string, for the reason both files spell
   * `HOST_ID`: an injected function arrives with nothing of its module around
   * it.
   */
  const mark = (row: Row, named: Element): void => {
    const draw = (): void => place(row, named);
    held = draw;
    window.addEventListener('scroll', follow);
    window.addEventListener('resize', follow);
    window.addEventListener('__imgwhy_closing__', unmark);
    draw();
  };

  /**
   * One grid of labels and values, with a mark on every held figure.
   *
   * The design's requirement as an element rather than a sentence: a figure
   * the cache could have contaminated is marked where it is shown, and the
   * footer says once what the mark means. `textContent` removes every existing
   * child, so the value is written before the mark is appended and never
   * after — the other order deletes the mark and leaves the footer's sentence
   * pointing at nothing.
   */
  const gridOf = (lines: Line[], meaning: string | null) => {
    const grid = document.createElement('dl');
    for (const line of lines) {
      const label = document.createElement('dt');
      label.textContent = line.label;
      grid.appendChild(label);

      const value = document.createElement('dd');
      value.textContent = line.value;
      if (line.held && meaning !== null) {
        const held = document.createElement('mark');
        held.textContent = 'cache';
        held.title = meaning;
        value.appendChild(held);
      }
      grid.appendChild(value);
    }
    return grid;
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
  const count = document.createElement('p');
  count.textContent = panel.head.counts;
  heading.appendChild(count);

  /**
   * The way out, which the toolbar button was the only one of.
   *
   * A reader who has read the panel should not have to remember which icon
   * opened it. The click does what the icon's second click does and in the
   * same order: the closing event first, so a mark comes down off the page
   * while its two window listeners are still there to be removed, and then the
   * host, which takes the panel and every listener inside this root with it.
   *
   * `read.ts` fires the same event for the same reason, and the constant is
   * written out here rather than shared because neither copy can see the other:
   * both functions arrive in the page as text.
   */
  const shut = document.createElement('button');
  shut.textContent = 'Close';
  shut.title = 'Close imgwhy';
  shut.addEventListener('click', (event) => {
    // The summary above would toggle the card shut under the click, so the
    // button's own act is the whole of what the click does.
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new Event('__imgwhy_closing__'));
    host.remove();
  });
  heading.appendChild(shut);

  // The two inputs, as fields. They are stated here and nowhere else on a
  // collapsed row: a row's reasoning names them again where a reader has asked
  // for it, which is behind the disclosure.
  heading.appendChild(
    gridOf(
      [
        { label: 'viewport width', value: panel.head.width, held: false },
        { label: 'pixel ratio', value: panel.head.dpr, held: false },
      ],
      null,
    ),
  );
  card.appendChild(heading);

  const list = document.createElement('ol');

  /**
   * One row of the list, as the item a reader points at.
   *
   * A function rather than the body of a loop, because the list is built more
   * than once: the order the rows are shown in is a reader's to change, and
   * changing it means writing the list again. Everything a row is — its
   * thumbnail, its heading, its clause, its two disclosures and its five
   * listeners — hangs off the item this returns, so a rewritten list takes the
   * old items and everything on them away with it.
   *
   * No return type written, the way `gridOf` above writes none: the element is
   * whatever `createElement` says it is, and naming the interface would put
   * one more DOM type in the list of names this package reaches for —
   * `privacy.test.ts` keeps that list to the sixteen it cannot work without,
   * and a type an inference already knows is not one of them.
   */
  const itemOf = (row: Row) => {
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
     *
     * An image too small to show anything gets no thumbnail at all. A `1×1`
     * drawn into the box is a square of one colour, which reads as a thumbnail
     * that failed, so the box says the size instead.
     */
    if (row.tiny !== null) {
      const size = document.createElement('small');
      size.textContent = row.tiny;
      top.appendChild(size);
    } else if (row.file === '') {
      // A box that says it is waiting. An `<img>` with no `src` drew its alt
      // text here, which reads as an image that failed rather than as one the
      // browser has not asked for yet — and a reader who meets that on nine
      // rows of a lazy page concludes the panel is broken.
      //
      // One word, because the box is 44 pixels wide and two break across the
      // middle of the second. The row's verdict beside it is the longer form:
      // `not loaded`, and a sentence under that.
      const waiting = document.createElement('small');
      waiting.textContent = 'waiting';
      top.appendChild(waiting);
    } else {
      const thumb = document.createElement('img');
      thumb.alt = row.alt;
      thumb.src = row.file;
      top.appendChild(thumb);
    }

    /**
     * The heading: the verdict, then the descriptor and the name, then the
     * mark where a file loaded.
     *
     * `output` is the element the platform has for the result of a
     * calculation, which is what a verdict is. Its class is the tone — one of
     * three words the extension owns — and it is the only class in the panel.
     * The word is what carries the meaning; the tone is what lets a reader
     * find the warnings in a column of rows before reading any of them.
     */
    const named = document.createElement('h2');
    const verdict = document.createElement('output');
    verdict.textContent = row.verdict.word;
    verdict.className = row.verdict.tone;
    named.appendChild(verdict);

    /**
     * The name is a button because activating it does something: it brings the
     * image it names into view. Inside it, the descriptor of the file that
     * loaded is a `code` token — it is a token, out of the `srcset` attribute
     * as the page wrote it — and the file name is `small`, which is the
     * element for a side note, and here it is one.
     */
    const name = document.createElement('button');
    const token = document.createElement('code');
    token.textContent = row.loaded;
    name.appendChild(token);
    const file = document.createElement('small');
    file.textContent = row.name;
    name.appendChild(file);
    named.appendChild(name);

    if (row.mark !== null) {
      const flag = document.createElement('mark');
      flag.textContent = 'cache';
      flag.title = row.mark;
      named.appendChild(flag);
    }
    top.appendChild(named);

    // The one short clause, which is the whole of what the collapsed row
    // says. `explain.ts` says why it is one clause and where the caveats went.
    const why = document.createElement('p');
    why.textContent = row.why;
    top.appendChild(why);

    item.appendChild(top);

    /**
     * The reasoning and the arithmetic, which open, and the files, which open
     * again.
     *
     * Two disclosures nested rather than one, because they answer two
     * questions in the order a reader asks them. The first is "because x y z":
     * the reasoning in prose, and then the steps, aligned. The second is
     * "which files, exactly": the whole URLs and where the image sat. Closed
     * by default, both of them, so the default view of twenty-three images is
     * twenty-three short clauses.
     *
     * The prose before the grid, which is the order this slice reversed. It
     * holds the sentence the collapsed row used to say — the device, the
     * clause, the pixels, the likely cause and the cure — so a reader who
     * opened the row meets the answer in words before the figures it was
     * worked out from.
     */
    const more = document.createElement('details');
    const opens = document.createElement('summary');
    opens.textContent = 'why, step by step';
    more.appendChild(opens);

    for (const note of row.notes) {
      const said = document.createElement('p');
      said.textContent = note;
      more.appendChild(said);
    }

    more.appendChild(gridOf(row.steps, row.mark));

    const deeper = document.createElement('details');
    const files = document.createElement('summary');
    files.textContent = 'files and where it sat';
    deeper.appendChild(files);
    deeper.appendChild(gridOf(row.details, row.mark));
    more.appendChild(deeper);

    item.appendChild(more);

    /**
     * Pointing at the image, which is what settles which row is which.
     *
     * Four listeners on the row and one on its button, all of them on nodes
     * inside this closed root. Not one is on a page element, which is why the
     * closing click's `remove()` takes them: there is nothing to unregister
     * and nothing on the page that outlives the panel. The two the mark hangs
     * on the window are the exception, and `mark` and `unmark` above are where
     * they go up and come down.
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
    item.addEventListener('mouseenter', () => mark(row, named));
    item.addEventListener('mouseleave', unmark);
    item.addEventListener('focusin', () => mark(row, named));
    item.addEventListener('focusout', unmark);

    /**
     * Activating the name brings the image into view.
     *
     * On the button rather than on the row, so that opening the arithmetic
     * does not also scroll the page — two controls, one job each. The button
     * answers Enter and Space with a click of its own, so there is no key
     * handler here and no key this panel has taught anybody.
     *
     * The window and nothing else, which is the one change to the page a click
     * here makes. `scrollIntoView` was the call this replaced and it scrolls
     * *every* scroll container between the image and the viewport — an
     * `overflow: hidden` one included, which is programmatically scrollable
     * with no scrollbar for a reader to undo it with. A page with a JavaScript
     * carousel holds its track at an offset its own code chose; scrolling a
     * slide into view moves that track while the carousel's index and dot
     * indicator still say otherwise, and nothing here puts it back. So an
     * image inside a clipped container stays clipped: the mark still says
     * where it sits, and the panel does not reach into machinery it cannot
     * restore.
     *
     * `scrollTo` takes a document coordinate where a rect is a viewport one,
     * which is what `window.scrollY` is doing in the sum. The image's own top
     * rather than its middle, and that is the one thing this gives up:
     * centring means halving a viewport height, this package performs no
     * division anywhere — `through-core.test.ts` refuses one, because a
     * density is a division and the arithmetic is core's — and core cannot be
     * asked, since a figure that depends on the box at click time is not a
     * figure the worker had. The top of the viewport is what additions say
     * exactly.
     *
     * `behavior: 'instant'` rather than the default, and it is not a
     * preference. A page with `scroll-behavior: smooth` in its own stylesheet
     * animates the scroll, and a rect read while the animation is in flight is
     * the box's position before it — a mark drawn where the image used to be.
     * The `scroll` listener would catch up; an instant scroll leaves nothing
     * to catch up on.
     *
     * A row whose image cannot be confirmed scrolls nowhere at all, and `mark`
     * is what says so on the row.
     */
    name.addEventListener('click', () => {
      const image = imageFor(row);
      if (image !== undefined) {
        const box = image.getBoundingClientRect();
        window.scrollTo({ top: box.top + window.scrollY, behavior: 'instant' });
      }
      mark(row, named);
    });

    return item;
  };

  /**
   * The rows with the ones that are a finding first, which is what a reader of
   * twenty-three images came for.
   *
   * Three passes over the same list rather than a comparator, and both halves
   * of that are deliberate. A sort would need a comparison function and would
   * reorder the list the panel was handed; three filters produce a new one,
   * keep document order inside each group without anybody having to know
   * whether the sort is stable, and are a comparison rather than arithmetic —
   * `through-core.test.ts` refuses a multiplication and a division because
   * those two lines are the selection algorithm, and a count and an order are
   * neither.
   *
   * The tone rather than the word, because the tone is exactly the three-way
   * question a reader is asking: is this a problem, can the panel not say, or
   * is it fine. `explain.ts` chooses the tone for every verdict and the header
   * counts them in the same order, so the list and the head agree about what
   * "worst" means.
   *
   * What the sorted list carries is the rows themselves and not their
   * positions. Every row holds `at`, the index into `document.images` that
   * `imageFor` confirms and the mark and the scroll are aimed at, so a row that
   * moved up the panel still points at the image it always described. That is
   * the one thing a sorted view must not lose, and `pointing.test.ts` holds it.
   */
  const worstFirst = (rows: Row[]): Row[] => {
    const toned = (tone: string): Row[] => rows.filter((row) => row.verdict.tone === tone);
    return [...toned('warn'), ...toned('quiet'), ...toned('good')];
  };

  /** Whether the list is showing the rows that are a finding first. */
  let worst = true;

  /**
   * Write the list, in whichever order is showing.
   *
   * `textContent` is what throws the old items away, and it takes every
   * listener on them with it: they are all on nodes inside this closed root,
   * which is the same property that makes the closing click one `remove()`.
   * The one thing it does not reach is a mark, whose two window listeners are
   * not on a node at all — so the caller that re-orders the list takes the
   * mark down first, and says why.
   *
   * Nothing here touches the window, which is what keeps the first render a
   * function of `document` alone: `panel.test.ts` builds the whole panel in a
   * context holding a document and nothing else, and that is a claim worth
   * keeping true.
   */
  const fill = (): void => {
    list.textContent = '';
    for (const row of worst ? worstFirst(shown.rows) : shown.rows) {
      list.appendChild(itemOf(row));
    }
  };

  /**
   * The panel showing, which starts as the one the worker computed and is
   * replaced by every answer after it.
   *
   * A binding rather than the argument, because a row for an image the browser
   * had not fetched is a row that cannot be judged yet, and the panel is what
   * finds out when it can. `again` below is what replaces this.
   */
  let shown = panel;

  /**
   * The reading the panel holds, updated in place as the page loads images.
   *
   * A copy of what the worker read, kept because the worker did not keep it:
   * a service worker sleeps between messages, so the whole reading has to
   * travel with the question. What changes when an image finally loads is what
   * is written here — the file, the pixels it decoded to, and the box, which a
   * decoded image can change.
   */
  const page = reading;

  /**
   * Ask the worker again, with whatever has loaded since.
   *
   * Trailing rather than immediate, because one scroll loads several images
   * and each of them would otherwise be a message, an answer and a list
   * rewritten under the reader's pointer. A short wait collapses a burst into
   * one question.
   *
   * The mark comes down first, for the reason the re-ordering control takes it
   * down: a mark is a closure over the row it went up for and over the heading
   * its word goes on, and the list is about to throw both away.
   */
  let queued = 0;
  const again = (): void => {
    queued += 1;
    const mine = queued;
    setTimeout(() => {
      // A later load has already asked, or the panel has closed and bumped the
      // count past this one. Either way this question is stale, and asking it
      // would rewrite the list a reader is looking at for an answer nobody is
      // waiting for. A counter rather than a timer handle, because a handle is
      // a number in a page and something else in Node, and this function is
      // read in both.
      if (mine !== queued) return;
      chrome.runtime
        .sendMessage<Panel>({ imgwhy: 'again', reading: page })
        .then((answer) => {
          if (answer === undefined || answer === null) return;
          shown = answer;
          count.textContent = shown.head.counts;
          unmark();
          fill();
          watch();
        })
        // A worker that has gone away, a panel whose page is closing: the
        // honest response is the panel staying as it is, which is what a
        // reader is already looking at.
        .catch(() => {});
    }, 150);
  };

  /**
   * Watch every image no row could judge, once each.
   *
   * The page's own lazy loading is what fires these: a reader scrolls, or
   * clicks a row and the panel scrolls to the image. Nothing here asks for a
   * file — the listener runs after the browser fetched one of its own accord,
   * which is what keeps the thumbnail's request the one the page already made.
   *
   * `once` is what makes a re-render safe. Every listener goes on a page
   * element rather than on a node in this root, so the closing `remove()` does
   * not take it — and a listener that fired is a listener the browser has
   * already dropped.
   */
  const watched = new Set<number>();
  const watching: (() => void)[] = [];

  /**
   * Take every watch off the page.
   *
   * These are the only listeners this panel puts on a page element, and that
   * makes them the only ones the closing `remove()` cannot take: everything
   * else hangs off the closed root and goes with it. So the closing event
   * takes them instead, the way it takes the mark's two window listeners, and
   * a page whose panel has been shut carries nothing of this extension again.
   */
  const release = (): void => {
    for (const drop of watching.splice(0)) drop();
    watched.clear();
    // Past every question in flight, so an answer that arrives after this is
    // one nothing acts on.
    queued += 1;
    window.removeEventListener('__imgwhy_closing__', release);
    releasing = false;
  };

  /**
   * Whether the closing event is being listened for, which it is only while
   * there is something on the page to take off it.
   *
   * The window is touched here for the same reason the mark touches it and
   * under the same condition: only when this panel has put something on a page
   * element. A page whose images have all loaded gets a panel that is a
   * function of `document` alone, which is what `panel.test.ts` builds one in.
   */
  let releasing = false;

  const watch = (): void => {
    const images = [...document.images];
    for (const image of page.images) {
      if (image.currentSrc !== '' || watched.has(image.at)) continue;
      const element = images[image.at];
      if (element === undefined) continue;
      watched.add(image.at);
      const loaded = (): void => {
        watched.delete(image.at);
        // The four facts a load changes. The srcset, the sizes and where the
        // element sits are the page's and did not move; the file, its pixels
        // and the box a decoded image can grow into are what did.
        const box = element.getBoundingClientRect();
        image.currentSrc = element.currentSrc;
        image.naturalWidth = element.naturalWidth;
        image.renderedWidth = box.width || element.width || 0;
        image.renderedHeight = box.height || element.height || 0;
        again();
      };

      element.addEventListener('load', loaded, { once: true });
      watching.push(() => {
        element.removeEventListener('load', loaded);
      });

      if (!releasing) {
        releasing = true;
        window.addEventListener('__imgwhy_closing__', release);
      }
    }
  };

  /**
   * Which order is showing, said, with the other one on the control.
   *
   * Only where there is more than one row, because a list of one has no order:
   * the line would be a statement about nothing and the control would do
   * nothing to it.
   *
   * The words before the control, in that order, for the reason the cache mark
   * is appended after its figure: writing a node's text removes every child it
   * had, so the other order deletes the button.
   */
  if (panel.rows.length > 1) {
    const order = document.createElement('p');
    const swap = document.createElement('button');

    const showing = (): void => {
      swap.textContent = worst ? 'Show document order' : 'Show warnings first';
      order.textContent = worst ? 'Showing warnings first' : 'Showing document order';
      order.appendChild(swap);
    };

    swap.addEventListener('click', () => {
      worst = !worst;
      // The mark comes down before the list is written again, and that is not
      // tidiness. A mark is a closure over the row it went up for and the
      // heading its `not found` word goes on, and both of those nodes are
      // about to be thrown away — so a box left up across a re-order would be
      // redrawn from a heading in no document, over an image whose row a
      // reader can no longer find.
      unmark();
      showing();
      fill();
    });

    showing();
    card.appendChild(order);
  }

  fill();
  watch();
  card.appendChild(list);

  /**
   * What the extension cannot do, behind one line.
   *
   * The sentences are the design's and every word of them is kept. What
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
