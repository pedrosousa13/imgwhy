# @imgwhy/extension

A Manifest V3 extension whose toolbar click is the only thing that ever runs.

Until you click it, it costs a page nothing. There is no content script, so
nothing of the extension is put on a page when the page loads. There are no
host permissions, so the extension has no standing access to any site. The
service worker holds one listener and one listener only — the toolbar click —
and Chrome lets it sleep the rest of the time.

When you do click it, the panel explains every image on the page: the `sizes`
clause that matched, the CSS width it resolved to, the physical pixels the
device needed, the candidates the page offered and the one the arithmetic
picks. The arithmetic is `@imgwhy/core`, the same call the command line makes,
so the two cannot disagree about the same page.

## What it cannot do, and says so

The extension explains and predicts. It does not measure, and the interface is
built around admitting that rather than around hiding it.

**A held copy is invisible.** A browser that already has a larger variant
reuses it, and selection never runs at all. The file the page ended up with
then disagrees with the arithmetic and nothing in the page can tell you which
of the two happened. So every figure the cache could account for carries a
`cache` mark where it is shown, the footer says once what the mark means, and a
row whose prediction and loaded file differ says why that is not necessarily a
bug.

**Bytes are unavailable.** `PerformanceResourceTiming.transferSize` reads zero
for a cross-origin response without `Timing-Allow-Origin`, which most image
CDNs do not send. The panel says `unknown` and never guesses a weight from
pixel dimensions. `npx imgwhy <url>` is where a measured figure comes from: it
drives the browser with the cache off and records real transfer sizes through
the DevTools Protocol.

## How one click works

`chrome.scripting.executeScript` does not send a function. It sends
`String(func)`, and the page evaluates the text — so an injected function
arrives with no imports, no module constants and no helpers. Core is a module,
and the arithmetic is not something to keep a second copy of.

So a click is three steps, and only data crosses into the page:

1. **`src/read.ts` is injected.** It walks `document.images` and returns plain
   serializable data per image, plus the viewport, the device pixel ratio and a
   count of the CSS background images. It decides nothing. If it finds a panel
   already open it removes it and returns nothing, which is the closing click.
2. **`src/explain.ts` runs in the worker.** It imports `@imgwhy/core` with a
   real `import` and asks `explainSelection` about each image, then words the
   answers.
3. **`src/panel.ts` is injected with those answers as `args`.** It builds the
   panel inside a closed shadow root out of the strings it was handed.

No `eval`, no `new Function`, no bundler, and no selection code anywhere in
this package. `test/through-core.test.ts` holds that last claim by refusing a
multiplication or a division anywhere in `src`: a density is a division and
physical pixels are a multiplication, and those two lines are the whole of the
algorithm.

## Load it

The manifest points at `dist/background.js`, which is built rather than
committed, so build first — from the repository root and not from this
directory, for the reason below.

```
npm run build
```

Then, in Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select `packages/extension`
4. Click the toolbar icon on any page. Click it again to close the panel.

There is no icon art. Icons are optional in Manifest V3 and Chrome draws a
letter in place of one, so the toolbar shows an `I`.

### Why the build is the root's and not this package's

A Manifest V3 service worker resolves no bare specifier. There is no import
map for an extension worker to resolve one against, so the `@imgwhy/core` that
`src/explain.ts` writes cannot survive into what Chrome loads — a worker that
names it fails at load, and the toolbar click does nothing at all.

So `scripts/build.mjs` finishes the extension's build by making its output
resolve against itself. It copies core's emitted JavaScript into `dist/core`,
which works wholesale because core's own imports are already relative, and
rewrites `'@imgwhy/core'` in the emitted files to the path of that copy. The
source keeps naming the package — that is what the typecheck and the
dependency table read, and the specifier is a build-time concern. Still no
bundler, and still no dependency: a copy and a string replacement.

`test/emitted.test.ts` is what holds it. It walks every import out of the
worker the manifest names, transitively, and fails on the first specifier that
is bare or resolves to no file — which is the check that was missing when this
package shipped an extension the whole suite called green and Chrome refused
to load.

`npm run build -w @imgwhy/extension` runs `tsc` alone and stops before the
rewrite, which leaves the bare specifier in place. Build from the root.

## Confirming the dormancy by hand

The tests are the real proof, and they run in CI:

| Check | Where |
| --- | --- |
| The manifest declares two permissions, no host permissions, no content script, and no URL pattern under any key | `test/manifest.test.ts` |
| The worker's top level does nothing but register the click, and the package names no API that fires without one | `test/dormant.test.ts` |
| The package can reach nothing that stores or sends | `test/privacy.test.ts` |
| The click reads the page, asks core, and renders — into the tab it was clicked in and no other | `test/click.test.ts` |
| The reader reads every image, and reads a `<picture>` the way a browser does | `test/read.test.ts` |
| The arithmetic is core's, over readings written by hand | `test/explain.test.ts` |
| No selection code lives here, and the page-side modules import nothing | `test/through-core.test.ts` |
| A hostile page stylesheet cannot reshape the panel, and every held figure is marked | `test/panel.test.ts` |
| A page written to break out of the panel reaches it as text and never as markup | `test/escaping.test.ts` |
| Nothing here reads a format or guesses a weight | `test/non-goals.test.ts` |
| Every import in the built output is relative and resolves to a file that is there | `test/emitted.test.ts` |

What follows is the same claim, checked by hand. It is worth doing once,
because it is the version you can show somebody.

**1. Watch the worker go to sleep.** Right after **Load unpacked**, the
extension's card carries a **service worker** link, because Chrome has just
run the worker to read its registrations. Leave the tab alone. Within about
thirty seconds the card reads **service worker (inactive)** — the worker
registered its one listener and Chrome stopped it.

**2. Visit pages without clicking.** Open a few sites in new tabs. Reload them.
Navigate around. Come back to `chrome://extensions`. The card still reads
**service worker (inactive)**. Nothing in the manifest gives Chrome a reason
to start the worker, so nothing started it.

If you want to watch this rather than infer it, click **service worker** while
it is running and leave that DevTools window open. Its console stays empty
through every page load, and the **inactive** label appears in it when Chrome
stops the worker.

**3. Look for the extension in a page you have not clicked on.** With a site
open and the icon unclicked, open the page's own DevTools:

- **Elements** — search for `__imgwhy_host__`. It is not there. The panel's
  host element is the only thing the extension ever adds to a page.
- **Sources** — the file tree lists the page's own scripts. No extension file
  appears under it, because none was injected.
- **Console** — empty of anything from the extension.
- **Network** — reload with the panel closed. Every request belongs to the
  page. The extension makes none, before the click or after it.

**4. Now click.** The worker wakes, the card gains its **service worker** link
back, and the panel appears at the bottom right. Search **Elements** again and
`__imgwhy_host__` is there — one `div`, empty, with a closed shadow root you
cannot open from the page. Click the icon a second time and the `div` goes
away.

**5. Check that clicking one tab does not reach another.** Click the icon in
one tab, then switch to another tab you have not clicked in. No panel. The
`activeTab` permission is granted by a click, for the tab you clicked in, and
does not carry over.

## What it stores and where it sends it

Nothing, and nowhere.

The extension keeps no state at all, including the obvious one: it does not
remember which tabs have a panel open. Whether the panel is open is a question
about the page, and the page is what answers it — `readPage` looks for its own
host element and removes it if it finds one. That is why a reload leaves
nothing to get wrong, and it is why there is no `chrome.storage` in the
manifest or in the code.

## How the panel survives a hostile page

The panel lives in a **closed** shadow root, and every declaration on `:host`
is `!important`, which is what makes an important page rule lose to it.

The cascade argument for that, and the three properties `all: initial` does not
reset, are written out where they are load-bearing: in the comment above the
stylesheet in `src/panel.ts`. `test/panel.test.ts` models the same cascade and
holds it against a page stylesheet written to break the panel, and its
`describe` for the boundary lists what the boundary cannot defend — an ancestor
`transform` on `html`, a custom property, and a page that plants the host id
itself.

Nothing the page wrote is ever parsed. Every selector, `sizes` string,
descriptor and candidate URL arrives through `textContent`, so there is no
escaping to get wrong: the panel builds a tree of elements it named itself, and
a string never becomes one. The stylesheet selects on tag names for the same
reason the panel writes only two properties — an id and the words it says.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3. Two permissions, no hosts, no content script. |
| `src/background.ts` | The service worker: one `chrome.action.onClicked` listener, and the three steps a click takes. |
| `src/read.ts` | The reader a click injects first. Self-contained, decides nothing, returns plain data. |
| `src/explain.ts` | The arithmetic, asked of `@imgwhy/core` in the worker where a real `import` works. |
| `src/panel.ts` | The renderer a click injects last, with the answers as `args`. Self-contained. |
| `src/chrome.d.ts` | The two extension APIs this package uses, written out. |
