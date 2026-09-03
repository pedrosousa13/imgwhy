import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const runner = fileURLToPath(new URL('./bare-context-runner.mjs', import.meta.url));
const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));

describe('core in a context with no globals', () => {
  it('runs the whole trace inside an empty vm context', () => {
    expect(existsSync(entry), `${entry} is missing — run \`npm run build\` first`).toBe(true);

    const run = spawnSync(
      process.execPath,
      ['--experimental-vm-modules', '--no-warnings', runner, entry],
      { encoding: 'utf8' },
    );

    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);

    const result = JSON.parse(run.stdout) as {
      absentFromSandbox: string[];
      candidateCount: number;
      clause: string;
      px: number;
      picked: string;
      explained: { clause: string; cssPx: number; neededPx: number; picked: string };
    };

    // Every one of these is missing from the sandbox, so any use would throw.
    expect(result.absentFromSandbox).toEqual([
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
    ]);

    expect(result.candidateCount).toBe(6);
    expect(result.clause).toBe('100vw');
    expect(result.px).toBe(640);
    expect(result.picked).toBe('1080w');

    // The joined call too, because that is the one a report ships into a page.
    expect(result.explained).toEqual({
      clause: '100vw',
      cssPx: 640,
      neededPx: 960,
      picked: '1080w',
    });
  });
});
