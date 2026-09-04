# 0001 — The cache mark goes per conclusion, not per figure

Accepted, 2026-09-04. Supersedes one sentence of the design for the extension panel only. Issue #36.

## The requirement as written

`docs/superpowers/specs/2026-09-03-imgwhy-design.md:139`:

> The extension explains and predicts. It cannot measure, for the two reasons in "The problem, stated exactly". The interface must say so wherever it shows a number that the cache could have contaminated.

Read literally, that is every figure on every row. `currentSrc` is what the browser has; a browser holding a larger variant reuses it, selection never runs, and no reading of a page tells that apart from a selection that ran and chose the same file. So the cache could have contaminated the loaded file on every row a file loaded, and #10 and #24 built the mark that way.

## What changed

On the maintainer's own page of twenty-three images the mark stood on all twenty-three rows. A word that never varies is decoration: it costs a reader attention on every row and tells them nothing about any of them. Eight of those rows had loaded nothing at all.

What made the literal reading affordable to drop is that the panel now has verdicts. `can’t tell` says the arithmetic descends from the held file. `oversized` says a held copy is the likeliest cause. Where the verdict already carries the information, the mark was saying it twice.

So the mark now goes where a held copy changes the conclusion, which `markFor` in `packages/extension/src/explain.ts` states as three clauses: the loaded file is not the file the arithmetic picked, the verdict rests on the held file, or a figure the row shows descends from it. Nothing else marks.

## What still holds

The footer's standing explanation is unchanged and still reachable, and its claim is about the panel rather than about a row:

> A marked figure is what the browser has, not what it chose. A browser holding a larger variant reuses it and selection never runs, so nothing marked can be read as the outcome of the arithmetic above.

That is as true of the rows that carry the mark now as it was of all of them, and it is the place the design's sentence is answered in full. The extension still measures nothing, still reports `bytes` as `unknown`, and still points at the command line for a measured weight.

## What to expect of `Line.held`

`held` stays per figure and means what it always meant: this figure is one a held copy could explain. What changed is that the flag is no longer sufficient on its own. `panel.ts` draws a chip where a line is flagged **and** the row carries a mark, so on a row `markFor` leaves alone the flags render nothing.

Two consequences worth knowing before editing either half:

- The `loaded` line is flagged on every row a file loaded, marked or not. It says which figure the mark is about; whether there is a mark at all is the row's.
- The `css px` and `needed` lines are flagged by `descendsFromHeld`, which is the same condition as the width half of the mark's wording. A chip on `0px` beside a mark that had stopped claiming the width was a real defect, found in review, and one name for the condition is what stops it coming back.

## The argument against

A reader who sees the mark on some rows and not others may conclude the unmarked rows were measured, which the extension cannot do for any row. #36 records that as the reason to keep the mark everywhere, and the footer is what answers it. If the argument wins, this decision is revertible on its own: the rule is one function and the branch is one commit.
