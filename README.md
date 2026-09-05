# imgwhy

Answers one question about any image on a page: **why did the browser download *that* file?**

DevTools shows you intrinsic size next to rendered size. Lighthouse tells you how many kilobytes you wasted. Neither tells you the reason. `imgwhy` runs the browser's own selection algorithm against the page's real `srcset`, real `sizes` and a real device pixel ratio, then shows the arithmetic step by step.

There are three ways to ask, and they share one implementation of the algorithm — `@imgwhy/core`, which none of them reimplements, so none of them can disagree with the others.

| Ask this way | You get | It measures |
| --- | --- | --- |
| **Command line** | Every image traced across five devices, with the bytes that really arrived | Yes |
| **HTML report** | The same run as one self-contained file, with controls to type different inputs | Yes, then predicts |
| **Chrome extension** | The page you are looking at, explained in place | No — it explains and predicts |

Only the command line can measure, and the difference is not a detail. It drives a real browser with the HTTP cache off and records transfer sizes over the DevTools Protocol. The extension reads a page the browser has already loaded, where a cached variant may mean selection never ran at all.

## Build it first

One npm workspace, TypeScript throughout, no runtime dependencies beyond Playwright for the command line.

```bash
npm install
npm run build
```

## Command line

```bash
# trace every image across the five default devices
node packages/cli/dist/bin.js https://example.com

# write a self-contained HTML report
node packages/cli/dist/bin.js https://example.com --report report.html

# the raw Capture, to stdout or to a file
node packages/cli/dist/bin.js https://example.com --json
node packages/cli/dist/bin.js https://example.com --out capture.json

# render some of the devices rather than all of them
node packages/cli/dist/bin.js https://example.com --device desktop
node packages/cli/dist/bin.js https://example.com --device iphone-se,ipad
```

The five default devices are iPhone SE (375×667, DPR 2), iPhone 15 Pro (393×852, DPR 3), Pixel 8 (412×915, DPR 2.625), iPad (820×1180, DPR 2) and Desktop (1440×900, DPR 1). Each renders in its own browser context with the cache disabled, so one device's download never explains another's. Drop an `imgwhy.config.json` beside the page you are working on to name a different set. `--device` selects from whichever set is in force, by id, and renders them in the set's own order.

Output is one block per image. An image with `w` descriptors gets the arithmetic laid out per device, because that is where the devices disagree:

```
url      https://web.dev/
images   10 on 5 devices
css      2 background images. A CSS background image has no selection mechanism at all,
         so imgwhy counts them and explains nothing further.

image 4 of 10  html > body > … > figure > a > picture > img   loading=lazy
  candidates  36w, 48w, 72w, 96w, 480w, 720w, 856w, 960w, 1440w, 1920w, 2880w
  sizes       (max-width: 840px) 50vw, 464px

  device         viewport  DPR    clause used              css px  needed  picked  file                bytes arrived
  iPhone SE      375×667   2      (max-width: 840px) 50vw  188px   375px   480w    ai-feature_480.png  11883
  iPhone 15 Pro  393×852   3      (max-width: 840px) 50vw  197px   590px   720w    ai-feature_720.png  11573
  Pixel 8        412×915   2.625  (max-width: 840px) 50vw  206px   541px   720w    ai-feature_720.png  11573
  iPad           820×1180  2      (max-width: 840px) 50vw  410px   820px   856w    ai-feature_856.png  11573
```

That is a real run. Where nothing was selected — no `srcset`, or one candidate — there is no table to lay out, so the block says why and reports the bytes per device instead. Where every device agrees on a figure it is written once and names no device; where they differ, each value names the devices that measured it.

### The URL is trusted input

The URL argument is on the same footing as any other shell argument: it decides what a real browser fetches, and imgwhy renders whatever the machine it runs on can reach. That includes loopback, link-local and private addresses, and it has to — `imgwhy http://localhost:3000` on a page under development is the ordinary case, and this repository's own fixtures render off a loopback server. Nothing stops the same command reaching an internal dashboard or a cloud metadata endpoint, and what such a page rendered comes back out through stdout, `--out` and `--report`.

Only the scheme is checked. `file:`, `data:` and `javascript:` are refused because they would read the disk or run script under the browser's own privileges; no rule anywhere looks at the host. The check runs once, on the URL as typed, before the page is opened, so a same-scheme redirect is followed wherever it leads and a public page that redirects to `http://127.0.0.1:…` renders that instead — the `url` line of the trace names where the page ended, not what you asked for. A cross-scheme redirect to `file:` is refused, but by Chromium and not by this tool: the run fails with `net::ERR_UNSAFE_REDIRECT`.

So a caller passing imgwhy URLs it did not choose — from a queue, a webhook, a form field — has to filter them before the call, because nothing here will. A hostname is the wrong thing to filter on, too: a name under someone else's control resolves into a private range as easily as a literal address does, and can resolve differently the second time it is looked up.

### The outputs carry every URL whole

The Capture and the report both write every URL exactly as the page offered it, query strings included: `currentSrc` and every candidate for every image, and the page's own URL besides. Nothing is stripped, and that is deliberate. Naming the file the browser fetched is the whole claim of this tool, and a URL with its query removed cannot be pasted into a browser to check the claim — two variants of one image can differ in nothing else.

So a signed URL leaves with the file. A CDN that charges by transformation puts a token in the query string, and so does a presigned bucket URL; `--json`, `--out` and `--report` all carry it, and the report is the artifact this README suggests you send to somebody. Stripping queries would be a half-measure in any case, because a filename can be the secret and the page URL travels either way. The decision is left where the knowledge is: whoever sends a report is the only one who can say whether the page it explains was sensitive. The report states this on its own page too, under the page URL, because a report travels without this file.

The trace on stdout is the one output that shortens a URL, and that is not a redaction either. It writes a file name and the first 40 characters of a query — 39 of the query itself, since the `?` is the first of them — because the `file` column has to stay narrow enough to read down. That is still enough to carry a short token.

## HTML report

`--report` writes one file that opens from disk, loads no remote resource and tells no third party you opened it. It holds a matrix of every image against every device, and under each image the arithmetic in full.

Every panel carries three controls — a `sizes` string, a viewport width, a DPR — and changing any of them re-picks from the candidates that page actually shipped. That is the counterfactual: the same `core` call the measurement used, with numbers you typed.

One honest limit is printed on the page: a framework reads `sizes` at build time to decide which files exist at all, so where it would also change the candidate list, the counterfactual understates the gain.

## Chrome extension

Nothing runs until you click. No content script, no host permissions, and a service worker holding exactly one listener — the toolbar click.

```bash
npm run build
```

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select `packages/extension`
4. Click the toolbar icon on any page. **Click it again to close the panel.**

There is no icon art, so the toolbar shows a letter. `packages/extension/README.md` covers loading it in more detail, and how to confirm the dormancy by hand in DevTools.

The panel lists every image in the order the page holds them, each with its arithmetic:

```
sizes         (max-width: 768px) 100vw, 33vw
clause used   33vw
css px        475px
needed        950px
candidates    640w, 1080w, 1920w
picked        1080w  /i/hero-1080.png
loaded        /i/hero-1920.png            cache
bytes         unknown
```

### What a `cache` mark means

A marked figure is what the browser **has**, not what it chose. The extension cannot measure, for two reasons the design states exactly:

- A browser holding a larger variant reuses it. Selection never runs, so `currentSrc` disagrees with the arithmetic through no fault of the markup. This is why resizing a window and reloading so often fails to reproduce what users see.
- `PerformanceResourceTiming.transferSize` returns zero for cross-origin responses without `Timing-Allow-Origin`, and most image CDNs do not send it.

So bytes are always `unknown` in the panel — never estimated from pixel dimensions, because guessed kilobytes would not be honest. For real weight, use the command line.

`sizes="auto"` carries the mark too, and the reason is worth stating: `auto` resolves against the element's laid-out width, which for an intrinsically-sized image *is* the width of whichever file the browser already held. The arithmetic then agrees with the loaded file because the cache produced both halves of it. The panel says so rather than presenting the coincidence as a confirmation.

## How selection works

Two stages, and people usually only know about the second.

**Stage one, build time.** A framework decides which files exist. Next.js greps your `sizes` string for `vw` tokens, takes the smallest percentage, and drops every candidate below `640 × ratio`. So `sizes` shapes the menu before any browser sees it. A string like `calc(100vw - 2rem)` matches nothing, because Next's regex wants a space or the string start before the digits and finds an opening bracket instead — the filter silently does not run and all sixteen candidates ship.

**Stage two, runtime.** The browser resolves `sizes` against the viewport — never against the element, because that measurement does not exist yet when the preload scanner reads the tag — multiplies by device pixel ratio, and takes the smallest candidate at or above that number.

```
sizes → CSS pixels × devicePixelRatio = physical pixels needed
smallest candidate ≥ needed wins
```

A 640px viewport at DPR 1.5 needs 960 physical pixels, so it downloads the 1080w file. Nothing about that is the element's fault.

## Limits

Each of these is a deliberate exclusion, not an oversight.

- **`<picture>` type negotiation is not evaluated.** Only `media` is. AVIF against WebP support is not modelled, and no code path reads a `type` attribute — a test enforces that by allowlisting the whole DOM surface the page-side code may touch.
- **CSS background images are counted and nothing more.** They reach the browser as a URL in a stylesheet with no `srcset` beside them, so there is nothing to select between and no arithmetic to show.
- **Bytes are never guessed.** Where transfer size is unavailable it reads `unknown`.
- **The report does not model framework generation.** It re-picks from the candidates a page shipped; it does not predict what Next.js would emit for a different `sizes` string.
- **The extension's panel is not a simulator.** Typed inputs live in the report.

## Packages

| Package | Role | Depends on |
| --- | --- | --- |
| `@imgwhy/core` | Parse `srcset`, resolve `sizes`, select a candidate. Pure functions, no imports, no DOM and no Node built-ins — it runs unchanged in Node, in a page and in a service worker. | nothing |
| `@imgwhy/runner` | Drive Playwright, produce a Capture. | core, playwright |
| `imgwhy` | Command line entry point. | core, runner, report |
| `@imgwhy/report` | Turn a Capture into one self-contained HTML file. | core |
| `@imgwhy/extension` | Manifest V3 extension. Explain the page you are looking at. | core |

A Capture is the seam: `runner` writes one, `report` reads one, and neither knows about the other.

`imgwhy.js`, `bg.js`, `manifest.json` and `icons/` at the repo root are the original single-file implementation, kept as the reference the typed packages were ported from. They carry no test suite and are **not** what ships — the extension lives in `packages/extension`.

## Privacy

The project collects nothing, and that is a constraint on the design rather than a policy page.

- No telemetry in any package.
- The report inlines every style, script and font, so opening one tells no third party that you opened it.
- The extension holds `activeTab` only. It stores no page data and sends nothing anywhere. Structural tests refuse the APIs that would let it.
- The command line writes only to the path you name.

## Development

```bash
npm test        # builds first, then runs the suite
npm run typecheck
```

`AGENTS.md` points at the conventions in `docs/agents/`.

## License

MIT
