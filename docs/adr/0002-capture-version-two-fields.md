# 0002 — A Capture's version is two fields, and each has one source

Accepted, 2026-09-07. Issue #69. Amended 2026-09-07 for issue #48, which landed `readAs` and took `CAPTURE_SCHEMA` to 2: one sentence in "The argument against" below, and nothing else.

## The question as put

A Capture carried `url`, `capturedAt`, `devices` and `runs`. It recorded when it was taken and never what took it, and #69 named two distinct things worth recording and asked deliberately whether they are one field or two:

> - **A schema version** — what shape these bytes are. This is what a reader keys forward-compatibility on, and it changes only when the shape changes.
> - **The producing version** — which imgwhy wrote it. This is what `diff` needs, because a `core` change alters the arithmetic without altering the shape at all.

## Two fields

They move on different clocks and answer different questions, and one field could only ever answer one of them.

`packages/cli/src/in.ts` has to refuse a shape it cannot read — in both directions, since a lower number is a shape this build no longer reads and a higher one a shape it does not read yet. That refusal keys on `version.schema`, and it is a refusal: a file the reader cannot describe is a file it must not answer out of.

`diff` must not refuse. Comparing a Capture kept from before an upgrade against one taken after it is the ordinary case, and a diff that stopped there would be useless the first time anyone upgraded. What it does instead is qualify: `compare.ts` carries the two releases where they differ, and the summary says a difference between them can be imgwhy's rather than the page's.

On one field those two behaviours cannot both hold. Keyed on a release number, every release is a possible shape change, so `in.ts` would refuse every Capture written by a neighbouring version — which is the behaviour `diff` exists not to have. Keyed on a shape number, `diff` cannot see the release that moved the figures, which is #49's whole premise: a silent change in the arithmetic makes a difference between two Captures mean something it did not mean.

## Nested under one key

`version: { schema, producedBy }` rather than two keys beside `capturedAt`. Every Capture written before this change carries neither, and under one key that file is one check — `version` is absent or is not an object — rather than two checks that can disagree about what an incomplete file is.

## Where each number comes from

Neither is typed in twice.

`schema` is `CAPTURE_SCHEMA`, exported by `@imgwhy/core` from `src/types.ts`, beside the `Capture` type it describes. The writer imports it and so does the reader, so the number a Capture is written under and the number it is read against are one constant. It is a literal because core names no import at all: that is what lets the same functions run in Node, in a page and in a service worker, and `packages/core/test/no-globals.test.ts` holds it.

`producedBy` is read from `imgwhy`'s own `package.json`, once, in `packages/cli/src/version.ts`. `imgwhy` is the package that gets published, so its `version` field is the number a release would bump, and the workspace root's manifest is private and never published. `run.ts` is the one reader today; the module exists rather than a literal there because the `--version` #73 will add needs the same string. No release has been cut yet, so every Capture written today records `0.0.0`, and a diff can only report a crossed boundary once that number moves. The runner is handed the string: `CaptureOptions.producedBy` is required, because this package is a library and its own release is not something it can read — and because every default that could stand in there is a number that would be written into a file and read back later as a release.

## What this cost core's shipped-source check

`packages/core/test/source.test.ts` compares every name a core module binds at its top level against the names the shipped copy declares, and the rule it enforced is that a core module may declare nothing up there but functions and its own `PARTS`. `CAPTURE_SCHEMA` is the second name exempted from that comparison, and an exemption by name is a hole in it: a shipped function reaching for the constant would resolve to nothing in a page. What the rule now says is that a core module's top level may hold functions, its own `PARTS`, and a constant no shipped function reads.

So the same file now also reads the shipped string for both exempted names, and every core module's imports for either under any alias. Two readings rather than one because neither sees the other's failure: the string catches a use inside the module that declares the constant, which no import would show, and the imports catch `import { CAPTURE_SCHEMA as SHAPE }` — which puts `SHAPE` and not the exempted name into the shipped text, and which the comparison is blind to because an import binds a name without declaring one. Both are narrower checks than the one they stand in for, and together they are what answers the failure the exemption opened.

## The argument against

One field is simpler, and simplicity here has a real claim: two numbers are two things to keep right, and a reader of a Capture has to know which of them answers the question they are asking.

The case for one is strongest if a release number can serve as both. It cannot serve as a shape number, for the reason above. What it could do is let the shape number go and have `in.ts` refuse on shape alone, the way it does today — which is exactly what #69 records as insufficient: `in.ts` "can only ever reject on shape", and #48's new field makes an absent field and a `false` value the same bytes. #48 landed `readAs: 'scrolled'` rather than a boolean, so an absent field and a written one are no longer the same bytes, but an absent one still says nothing at all — and it is `CAPTURE_SCHEMA` going to 2 that refuses a Capture written before the field.

The other shape considered and rejected was deriving `producedBy` inside the runner from its own `package.json`. It is one fewer required option, and it would record `@imgwhy/runner`'s version rather than the version a user has — a number nobody installs, and one that says nothing about the command that wrote the file.

If the argument for one field wins, this is revertible in the places it touches: one type, one constant, one module, one check in the reader and one line in the diff.
