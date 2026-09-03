# @imgwhy/extension

A Manifest V3 extension whose toolbar click is the only thing that ever runs.

Until you click it, it costs a page nothing. There is no content script, so
nothing of the extension is put on a page when the page loads. There are no
host permissions, so the extension has no standing access to any site. The
service worker holds one listener and one listener only — the toolbar click —
and Chrome lets it sleep the rest of the time.

The panel it injects says very little at this point. What it explains comes
next.

## Load it

The manifest points at `dist/background.js`, which is built rather than
committed, so build first.

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

## Confirming the dormancy by hand

The tests are the real proof, and they run in CI:

| Check | Where |
| --- | --- |
| The manifest declares two permissions, no host permissions, no content script, and no URL pattern under any key | `test/manifest.test.ts` |
| The worker's top level does nothing but register the click, and the package names no API that fires without one | `test/dormant.test.ts` |
| The package can reach nothing that stores or sends | `test/privacy.test.ts` |
| The click hands the panel to the tab it was clicked in, and to no other | `test/click.test.ts` |
| A second click removes the panel, and a hostile page stylesheet cannot reshape it | `test/panel.test.ts` |

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
about the page, and the page is what answers it — `togglePanel` looks for its
own host element and removes it if it finds one. That is why a reload leaves
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

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3. Two permissions, no hosts, no content script. |
| `src/background.ts` | The service worker: one `chrome.action.onClicked` listener. |
| `src/panel.ts` | The function the click injects. Self-contained, because `executeScript` sends its source rather than the function. |
| `src/chrome.d.ts` | The two extension APIs this package uses, written out. |
