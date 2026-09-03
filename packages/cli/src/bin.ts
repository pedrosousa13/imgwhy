#!/usr/bin/env node
import { capturePage } from '@imgwhy/runner';
import { run } from './run.js';

const outcome = await run(process.argv.slice(2), capturePage);
if (outcome.stdout) process.stdout.write(outcome.stdout);
if (outcome.stderr) process.stderr.write(outcome.stderr);
process.exitCode = outcome.code;
