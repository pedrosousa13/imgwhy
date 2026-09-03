/**
 * The panel, and the one function a click sends into the page.
 *
 * Everything below is inside `togglePanel`, including the strings and the
 * stylesheet, and that is a requirement rather than a style. `executeScript`
 * does not send the function: it sends `String(func)` and the page evaluates
 * that text. A constant declared beside the function, a helper it called, an
 * import it named are all gone by the time the text runs, and every one of
 * them is a `ReferenceError` in someone's browser. `panel.test.ts` runs the
 * text in a context holding a `document` and nothing else, which is the only
 * arrangement that can catch it.
 *
 * The other consequence is that this module has no top level worth speaking
 * of: one function declaration, no imports, no constants. `dormant.test.ts`
 * asks for that of every module here, because the worker imports this one and
 * an effect at its top level would run when the worker wakes.
 */

/**
 * Show the panel, or take it away if it is already there.
 *
 * The state is the page. There is no flag anywhere in the extension saying
 * which tabs have a panel open, and there is nowhere to put one that is not
 * `chrome.storage` — which the design rules out:
 *
 * > The extension holds `activeTab` only. It stores no page data and sends
 * > nothing anywhere.
 *
 * Reading the page instead is not a workaround. It is the only answer that
 * cannot go stale: the page navigated, the panel went with it, and the next
 * click opens rather than trying to close something that is no longer there.
 */
export function togglePanel(): 'opened' | 'removed' {
  // Underscored and prefixed, because it lands in the page's id namespace and
  // has to not collide with anything a site happens to have called its own.
  const HOST_ID = '__imgwhy_host__';

  const open = document.getElementById(HOST_ID);
  if (open !== null) {
    open.remove();
    return 'removed';
  }

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
  // inheritance and the `:host` rule has already closed it.
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
      width: 320px !important;
      max-width: calc(100vw - 32px) !important;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif !important;
      font-size: 13px !important;
      line-height: 1.5 !important;
      color: #16181d !important;
    }
    section {
      box-sizing: border-box;
      display: block;
      padding: 12px 14px;
      background: #ffffff;
      border: 1px solid #d5d8de;
      border-radius: 8px;
      box-shadow: 0 6px 24px rgba(16, 18, 22, 0.18);
    }
    h1 {
      margin: 0 0 4px;
      font-size: 13px;
      font-weight: 600;
    }
    p {
      margin: 0;
      color: #545a66;
    }
    p + p {
      margin-top: 6px;
    }
  `;
  root.appendChild(style);

  const panel = document.createElement('section');

  const title = document.createElement('h1');
  title.textContent = 'imgwhy';
  panel.appendChild(title);

  // Every word arrives through `textContent`. Nothing here builds markup from
  // a string, so nothing a page could arrange gets reinterpreted as a tag —
  // and the panel has no page content in it yet in any case, which is the
  // next slice's problem and worth already having the habit for.
  const first = document.createElement('p');
  first.textContent = 'Nothing ran on this page until you clicked. That is the point.';
  panel.appendChild(first);

  const second = document.createElement('p');
  second.textContent =
    'The arithmetic behind each image comes next. Click the toolbar icon again to close.';
  panel.appendChild(second);

  root.appendChild(panel);

  // The document element rather than the body. `position: fixed` resolves
  // against the nearest ancestor that established a containing block, and a
  // `transform`, `filter` or `perspective` on `body` makes one — so a page
  // that animates its body would drag the panel along with it. `html` can do
  // the same and almost never does.
  document.documentElement.appendChild(host);

  return 'opened';
}
