// Loads the built @imgwhy/core into a vm context whose global object starts
// empty, so nothing but the JavaScript intrinsics is reachable. Prints one JSON
// line describing what the sandbox lacks and what core computed inside it.
//
// Run as: node --experimental-vm-modules bare-context-runner.mjs <path to dist/index.js>
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const entry = process.argv[2];
const context = vm.createContext(Object.create(null));

const modules = new Map();
function load(file) {
  const cached = modules.get(file);
  if (cached) return cached;
  const module = new vm.SourceTextModule(readFileSync(file, 'utf8'), {
    identifier: file,
    context,
  });
  modules.set(file, module);
  return module;
}

const link = (specifier, referencingModule) =>
  load(resolve(dirname(referencingModule.identifier), specifier));

const ABSENT = [
  'document',
  'window',
  'location',
  'navigator',
  'process',
  'URL',
  'fetch',
  'require',
  'Buffer',
  'setTimeout',
  'TextEncoder',
];

const probe = new vm.SourceTextModule(
  `export const absent = ${JSON.stringify(ABSENT)}.filter((n) => typeof globalThis[n] === 'undefined');`,
  { identifier: '<probe>', context },
);
await probe.link(() => {
  throw new Error('the probe imports nothing');
});
await probe.evaluate();

const core = load(entry);
await core.link(link);
await core.evaluate();

const srcset = [
  '/i/a-640.png 640w',
  '/i/a-750.png 750w',
  '/i/a-828.png 828w',
  '/i/a-1080.png 1080w',
  '/i/a-1200.png 1200w',
  '/i/a-1920.png 1920w',
].join(', ');

const candidates = core.namespace.parseSrcset(srcset);
const resolution = core.namespace.resolveSizes('100vw', 640);
const picked = core.namespace.selectCandidate(candidates, resolution.px, 1.5);

// The three calls joined, which is the shape a report and an extension use.
const explained = core.namespace.explainSelection(
  {
    id: 'main > img',
    selector: 'main > img',
    candidates,
    sizes: '100vw',
    sizesSource: 'img',
    renderedWidth: 620,
    currentSrc: '/i/a-1080.png',
    naturalWidth: 1080,
    transferBytes: null,
    loading: null,
  },
  { id: 'bare', name: 'Bare', viewport: { width: 640, height: 800 }, dpr: 1.5 },
);

process.stdout.write(
  JSON.stringify({
    absentFromSandbox: probe.namespace.absent,
    candidateCount: candidates.length,
    clause: resolution.clause,
    px: resolution.px,
    picked: picked.raw,
    explained: {
      clause: explained.resolution.clause,
      cssPx: explained.cssPx,
      neededPx: explained.neededPx,
      picked: explained.picked.raw,
    },
  }),
);
