import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PROFILES } from '@imgwhy/runner';
import { beforeEach, describe, expect, it } from 'vitest';
import { configPathInside, loadDeviceProfiles } from '../src/config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'imgwhy-config-'));
});

const write = (contents: string): void =>
  writeFileSync(join(dir, 'imgwhy.config.json'), contents, 'utf8');

const failure = (contents: string): string => {
  write(contents);
  const result = loadDeviceProfiles(dir);
  if (result.ok) throw new Error(`expected ${contents} to be rejected`);
  return result.message;
};

describe('loadDeviceProfiles', () => {
  it('uses the default set when the project has no config file', () => {
    const result = loadDeviceProfiles(dir);

    expect(result).toEqual({ ok: true, profiles: DEFAULT_PROFILES });
  });

  it('replaces the default set rather than merging with it', () => {
    write(
      JSON.stringify({
        devices: [
          { id: 'kiosk', name: 'Kiosk', viewport: { width: 1080, height: 1920 }, dpr: 1 },
        ],
      }),
    );

    const result = loadDeviceProfiles(dir);

    expect(result).toEqual({
      ok: true,
      profiles: [
        { id: 'kiosk', name: 'Kiosk', viewport: { width: 1080, height: 1920 }, dpr: 1 },
      ],
    });
  });

  it('keeps the file order, because that is the order the trace reads in', () => {
    write(
      JSON.stringify({
        devices: [
          { id: 'b', name: 'B', viewport: { width: 800, height: 600 }, dpr: 2 },
          { id: 'a', name: 'A', viewport: { width: 400, height: 600 }, dpr: 1 },
        ],
      }),
    );

    const result = loadDeviceProfiles(dir);

    expect(result.ok && result.profiles.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('fails with the parse error rather than falling back to the defaults', () => {
    const message = failure('{ "devices": [ } ');

    expect(message).toContain('imgwhy.config.json is not valid JSON');
    // The parser's own words, so the reader can find the character at fault.
    expect(message).toMatch(/position|JSON/i);
  });

  it('rejects a profile with no dpr', () => {
    expect(
      failure(JSON.stringify({ devices: [{ id: 'a', name: 'A', viewport: { width: 5, height: 5 } }] })),
    ).toBe('imgwhy.config.json: devices[0].dpr must be a number above 0');
  });

  it('rejects a negative viewport', () => {
    expect(
      failure(
        JSON.stringify({
          devices: [{ id: 'a', name: 'A', viewport: { width: -800, height: 600 }, dpr: 1 }],
        }),
      ),
    ).toBe('imgwhy.config.json: devices[0].viewport.width must be a number above 0');
  });

  it('rejects a profile with no id', () => {
    expect(
      failure(JSON.stringify({ devices: [{ name: 'A', viewport: { width: 5, height: 5 }, dpr: 1 }] })),
    ).toBe('imgwhy.config.json: devices[0].id must be a non-empty string');
  });

  it('rejects two profiles sharing an id, because the runs key on it', () => {
    expect(
      failure(
        JSON.stringify({
          devices: [
            { id: 'a', name: 'A', viewport: { width: 5, height: 5 }, dpr: 1 },
            { id: 'a', name: 'Also A', viewport: { width: 6, height: 6 }, dpr: 1 },
          ],
        }),
      ),
    ).toBe('imgwhy.config.json: devices[1].id repeats "a", and every profile needs its own');
  });

  it('rejects an empty device set, which would render nothing', () => {
    expect(failure(JSON.stringify({ devices: [] }))).toBe(
      'imgwhy.config.json must carry a "devices" array holding at least one profile',
    );
  });

  it('rejects a file that carries no devices at all', () => {
    expect(failure(JSON.stringify({ profiles: [] }))).toBe(
      'imgwhy.config.json must carry a "devices" array holding at least one profile',
    );
  });

  it('rejects a config that is a symlink to a file outside the working directory', () => {
    const outside = mkdtempSync(join(tmpdir(), 'imgwhy-outside-'));
    writeFileSync(join(outside, 'secrets.json'), '{"devices":[]}', 'utf8');
    symlinkSync(join(outside, 'secrets.json'), join(dir, 'imgwhy.config.json'));

    const result = loadDeviceProfiles(dir);

    expect(result).toEqual({
      ok: false,
      message:
        'imgwhy.config.json resolves outside the working directory, so imgwhy will not read it',
    });
  });

  it('follows a symlink that stays inside the working directory', () => {
    mkdirSync(join(dir, 'config'));
    writeFileSync(
      join(dir, 'config', 'devices.json'),
      JSON.stringify({
        devices: [{ id: 'kiosk', name: 'Kiosk', viewport: { width: 1080, height: 1920 }, dpr: 1 }],
      }),
      'utf8',
    );
    symlinkSync(join(dir, 'config', 'devices.json'), join(dir, 'imgwhy.config.json'));

    const result = loadDeviceProfiles(dir);

    expect(result.ok && result.profiles.map((p) => p.id)).toEqual(['kiosk']);
  });
});

describe('configPathInside', () => {
  it('accepts a plain name in the working directory', () => {
    expect(configPathInside(dir, 'imgwhy.config.json')).not.toBeNull();
  });

  it.each(['../imgwhy.config.json', 'a/../../imgwhy.config.json', '/etc/passwd'])(
    'refuses %s',
    (name) => {
      expect(configPathInside(dir, name)).toBeNull();
    },
  );
});
