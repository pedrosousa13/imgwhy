# imgwhy — design

Date: 2026-09-03
Status: approved, ready for issue slicing
Milestones: M1 Explain one page, M2 Shareable report, M3 Dormant extension

## Purpose

A browser downloads one file from a `srcset`. No tool explains which one, or why.

DevTools shows intrinsic size next to rendered size. Lighthouse reports wasted kilobytes at one viewport. Neither names the `sizes` clause that fired. Neither answers "what happens if I change it".

imgwhy answers both. It measures a real page on real devices, then explains each choice as arithmetic you can read.

## The problem, stated exactly

Image selection runs in two stages. Most people know only the second one.

**Stage one, build time.** The framework decides which files exist. Next.js reads the `sizes` string, finds every `vw` token, takes the smallest percentage, and drops each candidate below `640 × ratio`. The `sizes` string shapes the candidate list before a browser sees it.

**Stage two, runtime.** The browser resolves `sizes` against the viewport. It never measures the element, because the preload scanner reads the tag before layout exists. It multiplies by device pixel ratio and takes the smallest candidate at or above that number.

```
sizes → CSS pixels × devicePixelRatio = physical pixels needed
smallest candidate ≥ needed wins
```

A 640px viewport at DPR 1.5 needs 960 physical pixels. It downloads the 1080w file. The element width never entered the calculation.

Two things break the explanation in practice:

1. **Cache.** A browser that holds a larger variant reuses it. Selection never runs. `currentSrc` then disagrees with the arithmetic, and no in-page tool can tell you why.
2. **Hidden bytes.** `PerformanceResourceTiming.transferSize` returns zero for cross-origin responses without `Timing-Allow-Origin`. Most image CDNs do not send it. An in-page tool cannot report real weight.

Both problems disappear when you drive the browser yourself.

## Approach

Render the page once per device profile in Playwright. Use a separate browser context for each profile, with a real `deviceScaleFactor`. Disable the cache. Record the requests through the Chrome DevTools Protocol, which reports real transfer sizes for every origin.

The result is measurement, not prediction.

## Architecture

Five packages in one npm workspace. TypeScript strict throughout.

| Package | Role | Depends on |
| --- | --- | --- |
| `@imgwhy/core` | Parse `srcset`. Resolve `sizes`. Select a candidate. Pure functions. | nothing |
| `@imgwhy/runner` | Drive Playwright. Produce a Capture. | core, playwright |
| `imgwhy` | Command line entry point. | core, runner, and report from M2 onward |
| `@imgwhy/report` | Turn a Capture into one self-contained HTML file. | core |
| `@imgwhy/extension` | Manifest V3 extension. Explain the page you are looking at. | core |

### core is the load-bearing decision

`core` imports nothing. It declares no DOM types and no Node built-ins. It runs unchanged in Node, in a page, and in a service worker.

This matters because every front end asks the same question of it:

```ts
selectCandidate(candidates, sizesPx, dpr): Candidate
resolveSizes(sizesString, viewportWidth): Resolution
parseSrcset(raw): Candidate[]
```

A measured result and a hypothetical result use the same call. The CLI passes numbers it recorded. The report passes numbers you typed into a control. The extension passes numbers it read from the live DOM. None of them reimplements the algorithm, so none of them can disagree with the others.

The reference implementation exists. `imgwhy.js` in this repo holds these functions and passes 13 unit tests, including the 640 at DPR 1.5 case that produced 1080w. Porting it to typed `core` is the first task, not a rewrite.

### Capture is the seam

`runner` writes a Capture. `report` reads a Capture. Neither knows about the other.

```ts
type Capture = {
  url: string
  capturedAt: string
  devices: DeviceProfile[]
  runs: DeviceRun[]
}

type DeviceProfile = {
  id: string
  name: string
  viewport: { width: number; height: number }
  dpr: number
}

type Candidate = {
  url: string
  w: number | null       // set for a w descriptor
  x: number | null       // set for an x descriptor, or 1 when absent
  raw: string            // the descriptor as written, for display
}

type CapturedImage = {
  id: string            // stable across device runs
  selector: string
  candidates: Candidate[]
  sizes: string | null
  sizesSource: 'img' | 'source'
  renderedWidth: number
  currentSrc: string
  naturalWidth: number
  transferBytes: number | null
  loading: 'lazy' | 'eager' | null
}
```

A Capture is JSON on disk. You can keep one, mail one, or diff two. The report is a pure function of a Capture, so the same file always renders the same page.

`CapturedImage.id` must stay stable across device runs, or the matrix cannot align rows. Derive it from the DOM path, and fall back to the candidate URL family when the path differs between renders.

## What each milestone delivers

### M1 — Explain one page

`npx imgwhy https://example.com` renders the page across the default device set and prints a trace for each image.

Done when the command reports, for every image and every device: the `sizes` clause that matched, the resolved CSS width, the pixels needed, the candidate picked, the bytes that arrived.

`core`, `runner` and `cli` land here. This milestone alone is a working tool.

### M2 — Shareable report

The same command writes `report.html`.

The file holds the device by image matrix, the per image arithmetic, and controls that recompute a different `sizes` string, viewport or DPR against the recorded candidates. `core` ships inside the file as bundled JavaScript, so counterfactuals resolve in the page with no server.

Done when the file opens correctly from disk, makes zero network requests, and renders the same in a browser that has never seen the site.

### M3 — Dormant extension

A toolbar click explains the page you are looking at.

Done when nothing runs before that click. The manifest declares `activeTab` and no host permissions. It registers no content script. The service worker stays asleep. There is no passive cost on any page you visit.

The extension explains and predicts. It cannot measure, for the two reasons in "The problem, stated exactly". The interface must say so wherever it shows a number that the cache could have contaminated.

## Privacy

The project collects nothing. This is a constraint on the design, not a policy page.

- No telemetry in any package.
- `report.html` inlines every style, script and font. It loads no remote resource, so opening a report tells no third party that you opened it. Use a system font stack.
- The extension holds `activeTab` only. It stores no page data and sends nothing anywhere.
- The command line writes only to the path you name.

## Testing

- **core** — unit tests in Vitest. Port the 13 existing cases first, then extend. Cover commas inside candidate URLs, `calc()` lengths, media condition order, and the largest-candidate fallback.
- **runner** — integration tests against a local fixture server. The fixtures serve pages with known `srcset` values, so results stay deterministic and the tests need no network.
- **report** — snapshot the emitted HTML. Add a DOM test that proves a changed `sizes` control produces a different selected candidate.
- **extension** — test the logic through `core`. Keep the panel thin enough that it needs no browser test.

## Non-goals

Each item below is a deliberate exclusion, not an oversight.

- **A hosted service.** Deferred to M4, which stays unopened until it is designed. It requires a queue, a request allowlist against server-side request forgery, and answers about what a hosted version stores. The privacy constraint above makes those answers harder, not easier.
- **Framework generation models.** The report changes `sizes` and re-picks from the candidates a page actually shipped. It does not model what Next.js would emit for a different `sizes` string. State this limit in the report: where a framework would also change the candidate list, the counterfactual understates the gain.
- **`<picture>` type negotiation.** Evaluate `media` only. Do not model AVIF against WebP support.
- **CSS background images.** Count them and say they have no selection mechanism. Analyze nothing further.
- **Estimated bytes.** Where `transferBytes` is null, report it as unknown. Do not guess from pixel dimensions.

## Open questions for planning

1. Which device profiles ship as the default set, and does a project override them from a file?
2. Does the M1 command emit machine-readable JSON as well as human-readable text?

## Security

`.factory/config.json` records `attackSurface: true`.

M1 loads arbitrary user-supplied URLs in a real browser. M3 reads page content. Both carry real surface, and both should receive an OWASP sweep issue during planning. M2 emits a static file and probably does not.
