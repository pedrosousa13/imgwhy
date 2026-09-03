import type { Candidate, CapturedImage, DeviceProfile, Selection } from '@imgwhy/core';

/**
 * One image's arithmetic, as the panel prints it.
 *
 * Strings rather than numbers, because rounding is presentation and this is
 * the presentation. `core` keeps every figure exact; a reader checking the
 * multiplication needs the figures they can see.
 */
export type Readout = {
  /** The `sizes` clause that matched, or the word for why none was consulted. */
  clause: string;
  /** The CSS width selection ran against. */
  cssPx: string;
  /** The physical pixels the device needed. */
  needed: string;
  /** The descriptor a browser downloads. */
  picked: string;
  /** Why that candidate won, as a sentence with the arithmetic in it. */
  reason: string;
  /** One marker per candidate, in the order the Capture recorded them. */
  marks: string[];
};

/** What the panel needs to recompute one image. */
export type Panel = {
  /** The image, as the first device that rendered it saw it. */
  image: CapturedImage;
  /** The device the controls start from, and whose sighting `image` is. */
  device: DeviceProfile;
};

/** Everything the page needs, which is every panel and nothing else. */
export type PageData = { panels: Panel[] };

/**
 * Turn one selection into the lines a panel shows.
 *
 * ## This function is shipped into the page as its own source
 *
 * `script.ts` writes `String(readPanel)` into the report, so the panel the
 * reader types into and the panel this package renders are one function, not
 * two that have to be kept saying the same thing. That is the same argument
 * `coreSource()` makes for the algorithm, applied to the words around it: a
 * second implementation of "why the winner won" is a second thing to get
 * wrong, and nothing would notice when they drifted.
 *
 * It costs one rule, and the rule is absolute: **this function may reach
 * nothing outside itself.** No import, no helper from this module, no constant
 * — a name from this file is a name the page does not have, and a build that
 * rewrites a cross-module call would rewrite it into something the page cannot
 * run. Its parameters and the language's own globals are all it gets, which is
 * why the small helpers below are declared inside it. `in-page.test.ts` runs
 * the shipped copy in a context with no globals and compares it against this
 * one, so a reach outside fails there rather than in someone's browser.
 *
 * It is the rule `collectImages` already keeps in the runner, for the same
 * reason: "Playwright sends this function to the browser as source, so it may
 * not reference anything outside itself."
 *
 * The selection arrives already made, rather than being made here, for the
 * same reason: `explainSelection` lives in another module. The page calls core
 * and hands the answer over, exactly as `report.ts` does.
 */
export function readPanel(selection: Selection, candidates: Candidate[], dpr: number): Readout {
  const round = (px: number): string => `${Math.round(px)}px`;
  const marks = (picked: Candidate | null): string[] =>
    candidates.map((candidate) => (candidate === picked ? '← picked' : ''));

  if (candidates.length === 0) {
    return {
      clause: 'no srcset',
      cssPx: '—',
      needed: '—',
      picked: '—',
      reason: 'The page shipped no srcset, so there was nothing to select.',
      marks: [],
    };
  }

  const picked = selection.picked;
  const raw = picked === null ? '—' : picked.raw;

  if (selection.kind === 'density') {
    const reached = picked !== null && picked.x !== null && picked.x >= dpr;
    const reason =
      picked === null
        ? 'No candidate carries a descriptor a browser can select on.'
        : reached
          ? `${raw} is the smallest density at or above DPR ${dpr}.`
          : `No density reaches DPR ${dpr}, so the largest wins: ${raw}.`;
    return {
      clause: 'x descriptors only',
      cssPx: '—',
      needed: '—',
      picked: raw,
      reason,
      marks: marks(picked),
    };
  }

  if (selection.kind === 'unreadable') {
    const reason =
      picked === null
        ? `The clause ${selection.resolution.clause} carries no length to read, and no ` +
          'candidate carries a density, so nothing could be selected.'
        : `The clause ${selection.resolution.clause} carries no length to read, so ${raw} ` +
          'won on its density alone.';
    return {
      clause: selection.resolution.clause,
      cssPx: 'unreadable',
      needed: '—',
      picked: raw,
      reason,
      marks: marks(picked),
    };
  }

  const needed = Math.round(selection.neededPx);
  const reached =
    picked !== null &&
    (picked.w !== null ? picked.w >= selection.neededPx : picked.x !== null && picked.x >= dpr);
  const arithmetic =
    `${Math.round(selection.cssPx)} css px × DPR ${dpr} = ${needed} physical pixels`;
  const reason =
    picked === null
      ? `${arithmetic}, and no candidate carries a descriptor a browser can select on.`
      : reached
        ? `${arithmetic}, and ${raw} is the smallest candidate at or above that.`
        : `${arithmetic}, and no candidate reaches that, so the largest wins: ${raw}.`;

  return {
    clause: selection.resolution.clause,
    cssPx: round(selection.cssPx),
    needed: round(selection.neededPx),
    picked: raw,
    reason,
    marks: marks(picked),
  };
}
