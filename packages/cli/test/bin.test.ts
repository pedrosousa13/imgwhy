import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type FixtureServer,
  startFixtureServer,
} from '../../runner/test/fixture-server.js';

const run = promisify(execFile);
const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

type Ran = { code: number; stdout: string; stderr: string };

async function imgwhy(...args: string[]): Promise<Ran> {
  try {
    const { stdout, stderr } = await run(process.execPath, [bin, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

let server: FixtureServer;
beforeAll(async () => {
  expect(existsSync(bin), `${bin} is missing — run \`npm run build\` first`).toBe(true);
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

describe('the imgwhy command', () => {
  it('traces a real page rendered in a real browser', async () => {
    const url = `${server.url}/media-clauses.html`;

    const ran = await imgwhy(url);

    expect(ran.stderr).toBe('');
    expect(ran.code).toBe(0);
    expect(ran.stdout).toBe(
      [
        `url        ${url}`,
        'device     Desktop — 1440×900 at DPR 1',
        'element    html > body > main > img',
        'candidates 640w, 1080w, 1920w',
        'rendered   720 css px',
        '',
        'sizes (min-width: 1000px) 50vw, 100vw',
        '  clause used  (min-width: 1000px) 50vw',
        '  resolves to  720px at viewport 1440',
        '  × DPR 1  =  720 physical pixels needed',
        '  smallest candidate ≥ that  →  1080w',
        'predicted  1080.png',
        'actual     1080.png',
        '',
      ].join('\n'),
    );
  }, 60_000);

  it('exits non-zero on a page where nothing selects a file', async () => {
    const ran = await imgwhy(`${server.url}/no-srcset.html`);

    expect(ran.code).toBe(1);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toContain('more than one srcset candidate');
  }, 60_000);

  it('refuses a file: URL', async () => {
    const ran = await imgwhy('file:///etc/passwd');

    expect(ran.code).toBe(1);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toBe(
      'imgwhy opens http: and https: pages only, and "file:///etc/passwd" is file:\n',
    );
  });
});
