# imgwhy

A Chrome extension that answers one question about any image on a page: **why did the browser download *that* file?**

DevTools shows you intrinsic size next to rendered size. Lighthouse tells you how many kilobytes you wasted. Neither tells you the reason. `imgwhy` recomputes the browser's own selection algorithm against the page's real `srcset`, real `sizes`, and your real device pixel ratio, then shows the arithmetic step by step.

It also lets you change the inputs. Type a different `sizes` string, a different viewport width, a different DPR, and watch which candidate wins — without touching the codebase.

## Install

No store listing. Load it unpacked:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select this folder
4. Click the toolbar icon on any page. Press `Esc` to close the panel.

To use it without installing anything, paste the contents of `imgwhy.js` into the DevTools console. The console is exempt from Content Security Policy, so this works on sites that block bookmarklets.

## What the panel shows

Images are listed worst-waste first. Each row gives the rendered CSS width, the physical pixels the display can actually resolve, and what arrived.

Open a row for the trace:

```
sizes (max-width: 768px) 100vw, 33vw
  clause used  (max-width: 768px) 100vw
  resolves to  640px at viewport 640
  × DPR 1.5  =  960 physical pixels needed
  smallest candidate ≥ that  →  1080w
predicted  hero-1080.webp
actual     hero-1920.webp   ← differs: a larger variant was already cached, so no new pick ran
```

That last line is the part other tools cannot give you. When the prediction and `currentSrc` disagree, selection never ran — the browser found a bigger variant in cache and reused it. This is why resizing a window and reloading so often fails to reproduce what users see.

Also flagged:

- `sizes="auto"`, where the browser measures real laid-out width instead of trusting your promise
- a `<source>` element overriding the `<img>` inside a `<picture>`
- `sizes` strings this parser cannot evaluate
- images decoded below the requested width, meaning the source was too small and no upscale happened
- elements with only a CSS `background-image`, which have no selection mechanism at all

## Simulating

Every open row carries three controls: a `sizes` field, a viewport width, and a DPR dropdown. Changing any of them recomputes the pick against that image's real candidate list.

**Apply sizes to live element** writes the string to the actual DOM node so you can watch the Network panel. Note that a smaller choice usually will not refetch, because the larger file is already cached.

## How selection works

Two stages, and people usually only know about the second.

**Stage one, build time.** A framework decides which files exist. Next.js greps your `sizes` string for `vw` tokens, takes the smallest percentage, and drops every candidate below `640 × ratio`. So `sizes` shapes the menu before any browser sees it. A string like `calc(100vw - 2rem)` matches nothing, because Next's regex wants a space or the string start before the digits and finds an opening bracket instead — the filter silently does not run and all sixteen candidates ship.

**Stage two, runtime.** The browser resolves `sizes` against the viewport (never against the element — that measurement does not exist yet when the preload scanner reads the tag), multiplies by device pixel ratio, and takes the smallest candidate at or above that number.

```
sizes → CSS pixels × devicePixelRatio = physical pixels needed
smallest candidate ≥ needed wins
```

A 640px viewport at DPR 1.5 needs 960 physical pixels, so it downloads the 1080w file. Nothing about that is the element's fault.

## Limits

- `<picture>` type negotiation (AVIF versus WebP) is not evaluated. Only `media` is.
- `vh` units in `sizes` are not resolved.
- Media conditions support `min-width` and `max-width` joined by `and`.
- Byte sizes are not reported. `PerformanceResourceTiming.transferSize` returns zero for cross-origin responses without `Timing-Allow-Origin`, and most image CDNs do not send it. Pixel ratios are honest; guessed kilobytes would not be.

## Files

| File | Role |
| --- | --- |
| `imgwhy.js` | The whole tool. Injected as a content script, or pasted into the console. Renders into a shadow root so page CSS cannot reach it. |
| `bg.js` | Service worker. Injects `imgwhy.js` when the toolbar icon is clicked. |
| `manifest.json` | Manifest V3. Permissions are `scripting` and `activeTab` only — nothing runs until you click. |

No dependencies, no build step, no network calls.

## License

MIT
