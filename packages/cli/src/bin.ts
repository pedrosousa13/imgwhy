#!/usr/bin/env node
import { capturePage } from '@imgwhy/runner';
import { runDiff } from './diff.js';
import { run } from './run.js';

// Dispatch before parsing, and on the first argument alone. `diff` reads two
// Captures and every other line renders a page, so the two have no grammar in
// common and neither parser has to know about the other's. A line that does
// not begin with `diff` reaches `parseArgs` exactly as it did.
const argv = process.argv.slice(2);
const outcome = argv[0] === 'diff' ? runDiff(argv.slice(1)) : await run(argv, capturePage);
if (outcome.stdout) process.stdout.write(outcome.stdout);
if (outcome.stderr) process.stderr.write(outcome.stderr);
process.exitCode = outcome.code;
