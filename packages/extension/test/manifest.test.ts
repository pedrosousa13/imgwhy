import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Rules } from './surface.js';
import { why } from './surface.js';

const manifestPath = fileURLToPath(new URL('../manifest.json', import.meta.url));
const packageRoot = fileURLToPath(new URL('../', import.meta.url));

/** The manifest as JSON, which is the only shape Chrome ever reads it in. */
type Manifest = Record<string, unknown>;

/**
 * Every key the manifest may declare.
 *
 * An allowlist rather than a list of keys to refuse, and that is the point of
 * it. `content_scripts` is one way to put code on a page before anyone clicks;
 * `devtools_page`, `chrome_url_overrides`, `side_panel` and
 * `declarative_net_request` are four more, and so is whatever the next
 * manifest version calls the fifth. A list of the ones to refuse is a list
 * someone has to keep complete against a schema Chrome owns. This one refuses
 * everything not named, so a key that runs without a click cannot arrive by
 * being forgotten. Adding a name is the deliberate act.
 *
 * Seven names is the whole of the extension: what it is, what it may do, and
 * the two things a click needs — a toolbar button to click and a worker to
 * wake. `icons` is deliberately not here. They are optional in Manifest V3,
 * and Chrome draws a letter in place of one.
 */
const KEYS = new Set([
  'action',
  'background',
  'description',
  'manifest_version',
  'name',
  'permissions',
  'version',
]);

/**
 * The two permissions, exactly.
 *
 * `activeTab` is the design's constraint, and `scripting` is what a click
 * needs: `chrome.scripting.executeScript` refuses to run without it. Neither
 * is a host permission — a host permission is a URL the extension may reach
 * whether or not you are looking at it, and that is the whole of what
 * `host_permissions` means. `activeTab` grants the same access to one tab, for
 * as long as the click lasts, and grants it at the moment of the click rather
 * than at install.
 */
const PERMISSIONS = ['activeTab', 'scripting'];

/**
 * Keys refused by name as well as by absence from the allowlist above.
 *
 * The allowlist already covers the shipped manifest. This covers the next
 * contributor, who adds a key to it because one entry seemed harmless. Both
 * lists have to be edited to give the extension a passive cost, and the line
 * this produces says which of them stopped it.
 */
const PASSIVE: Rules = [
  [/^content_scripts$/, 'a content script, which runs on page load'],
  [/^host_permissions$/, 'a host permission, which is access granted without a click'],
  [/^web_accessible_resources$/, 'files a page may load out of the extension itself'],
  [/^externally_connectable$/, 'a page that may open a channel to the extension'],
  [/^declarative_net_request$/, 'rules the browser applies to requests with nothing running'],
  [/^(?:devtools_page|chrome_url_overrides|side_panel|omnibox|chrome_settings_overrides)$/, 'a surface the browser loads on its own'],
];

/**
 * Every shape a URL match pattern takes.
 *
 * A pattern is how the manifest names pages, and every key that names pages
 * carries one — `content_scripts[].matches`, `host_permissions`,
 * `web_accessible_resources[].matches`, and a permission written as a URL
 * rather than as an API name. The allowlist above refuses each of those keys,
 * so this is the second reading of the same claim: whatever key a pattern is
 * written under, it is a page the extension declared an interest in, and this
 * extension declares none.
 */
const MATCHES: Rules = [
  [/<all_urls>/, 'every URL there is'],
  [/(?:^|[^a-z0-9])\*:\/\//i, 'every scheme'],
  [/\b[a-z][a-z0-9+.-]*:\/\//i, 'a URL scheme'],
];

/**
 * Every string in the manifest, keys included.
 *
 * Keys as well as values, because a pattern can be either: `permissions`
 * holds patterns as values, and a hypothetical key-per-host would hold them as
 * keys. The reading costs nothing and the manifest is small.
 */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, held]) => [key, ...strings(held)]);
  }
  return [];
}

/** Why the background is not one module service worker, one line each. */
function background(manifest: Manifest): string[] {
  const declared = manifest.background;
  if (typeof declared !== 'object' || declared === null) return ['declares no background at all'];

  const held = declared as Record<string, unknown>;
  return [
    ...(typeof held.service_worker === 'string' ? [] : ['declares a background with no service worker']),
    // A worker that is not a module cannot import, and the one thing this
    // worker does at its top level is import the function it injects.
    ...(held.type === 'module' ? [] : ['declares a service worker that is not a module']),
    ...Object.keys(held)
      .filter((key) => key !== 'service_worker' && key !== 'type')
      .map((key) => `declares background.${key}`),
  ];
}

/**
 * Every way one manifest costs a page something before a click, one line
 * each. Empty is clean.
 */
function findings(manifest: Manifest): string[] {
  const permissions = manifest.permissions;
  const declared = Array.isArray(permissions) ? [...permissions].map(String).sort() : null;

  const found = [
    ...(manifest.manifest_version === 3 ? [] : [`is manifest version ${String(manifest.manifest_version)}`]),
    ...Object.keys(manifest).flatMap((key) => {
      const reason = why(PASSIVE, key);
      if (reason !== undefined) return [`declares ${key}, which is ${reason}`];
      return KEYS.has(key) ? [] : [`declares ${key}`];
    }),
    ...(declared === null
      ? ['declares no permissions array']
      : declared.join(' ') === PERMISSIONS.join(' ')
        ? []
        : [`declares the permissions ${declared.join(', ')}`]),
    ...strings(manifest).flatMap((value) => {
      const reason = why(MATCHES, value);
      return reason === undefined ? [] : [`names ${reason} in "${value}"`];
    }),
    ...background(manifest),
  ];

  return [...new Set(found)];
}

/**
 * The manifest, read as the only thing that can put code on a page.
 *
 * The design's M3:
 *
 * > Done when nothing runs before that click. The manifest declares
 * > `activeTab` and no host permissions. It registers no content script. The
 * > service worker stays asleep. There is no passive cost on any page you
 * > visit.
 *
 * Three of those four sentences are properties of this file alone, and none of
 * them can be observed from a running extension: an extension with a content
 * script looks identical once you have clicked it. So the file is read
 * directly, and read by an allowlist, because the interesting question is not
 * whether the keys we thought of are absent but whether any key at all is
 * present that we did not put there.
 *
 * `dormant.test.ts` carries the fourth sentence, which is a property of the
 * worker's source rather than of this file.
 */
describe('the shipped manifest', () => {
  const text = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(text) as Manifest;

  it('is there to read, so nothing below passes for want of a file', () => {
    // The check reads a manifest rather than passing on an empty object whose
    // every key is absent for the most boring reason available.
    expect(Object.keys(manifest).length).toBeGreaterThan(0);
    expect(manifest.name).toBe('imgwhy');
  });

  it('is Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('declares activeTab and scripting, and no other permission', () => {
    expect(manifest.permissions).toEqual(PERMISSIONS);
  });

  it('declares no host permissions', () => {
    expect(manifest).not.toHaveProperty('host_permissions');
  });

  it('registers no content script', () => {
    expect(manifest).not.toHaveProperty('content_scripts');
  });

  it('names no page anywhere in it, under any key', () => {
    const named = strings(manifest).filter((value) => why(MATCHES, value) !== undefined);

    expect(named).toEqual([]);
  });

  it('declares only the seven keys the allowlist names', () => {
    expect(Object.keys(manifest).sort()).toEqual([...KEYS].sort());
  });

  it('backs itself with one module service worker and nothing else', () => {
    expect(manifest.background).toEqual({
      service_worker: 'dist/background.js',
      type: 'module',
    });
  });

  it('points at a worker that is actually there, so the click has something to wake', () => {
    // `pretest` builds before this runs, so the compiled worker exists. A
    // renamed output would otherwise be an extension that fails to load, and
    // an extension that fails to load is dormant in the least useful sense.
    const worker = (manifest.background as { service_worker: string }).service_worker;

    expect(existsSync(new URL(worker, `file://${packageRoot}`))).toBe(true);
  });

  it('gives the toolbar a button, which is the one thing that ever runs', () => {
    expect(manifest.action).toEqual({ default_title: 'imgwhy — why this image?' });
  });

  it('is clean by the whole reading, not only by the checks written out above', () => {
    expect(findings(manifest)).toEqual([]);
  });
});

/**
 * The reading, given the manifests it exists to refuse.
 *
 * Each entry below is a real way to give the extension a passive cost, and
 * they are held here rather than tried against a real browser and reverted, so
 * the failure they should cause is a passing test instead of a note in a
 * commit message.
 */
describe('the manifest reading, given a manifest that costs a page something', () => {
  /** The shipped manifest, as an object to spread a change onto. */
  const dormant: Manifest = {
    manifest_version: 3,
    name: 'imgwhy',
    version: '0.0.0',
    description: 'Explain why the browser downloaded that file.',
    permissions: ['activeTab', 'scripting'],
    action: { default_title: 'imgwhy' },
    background: { service_worker: 'dist/background.js', type: 'module' },
  };

  it('is quiet about the arrangement that ships', () => {
    expect(findings(dormant)).toEqual([]);
  });

  const attacks: [string, Manifest, string[]][] = [
    [
      'a content script, which is the whole of what dormancy excludes',
      { ...dormant, content_scripts: [{ matches: ['<all_urls>'], js: ['panel.js'] }] },
      [
        'declares content_scripts, which is a content script, which runs on page load',
        'names every URL there is in "<all_urls>"',
      ],
    ],
    [
      'a host permission, granted at install rather than at the click',
      { ...dormant, host_permissions: ['*://*/*'] },
      [
        'declares host_permissions, which is a host permission, which is access granted without a click',
        'names every scheme in "*://*/*"',
      ],
    ],
    [
      'one host, which is a host permission written small',
      { ...dormant, host_permissions: ['https://example.com/*'] },
      [
        'declares host_permissions, which is a host permission, which is access granted without a click',
        'names a URL scheme in "https://example.com/*"',
      ],
    ],
    [
      'a match pattern filed under a key the allowlist does allow',
      { ...dormant, permissions: ['activeTab', 'scripting', 'https://example.com/*'] },
      [
        'declares the permissions activeTab, https://example.com/*, scripting',
        'names a URL scheme in "https://example.com/*"',
      ],
    ],
    [
      'a resource a page may load out of the extension, which needs no click at all',
      {
        ...dormant,
        web_accessible_resources: [{ resources: ['panel.js'], matches: ['<all_urls>'] }],
      },
      [
        'declares web_accessible_resources, which is files a page may load out of the extension itself',
        'names every URL there is in "<all_urls>"',
      ],
    ],
    [
      'a devtools page, which the browser loads whenever DevTools opens',
      { ...dormant, devtools_page: 'devtools.html' },
      ['declares devtools_page, which is a surface the browser loads on its own'],
    ],
    [
      'a permission that is neither of the two',
      { ...dormant, permissions: ['activeTab', 'scripting', 'storage'] },
      ['declares the permissions activeTab, scripting, storage'],
    ],
    [
      'the tabs permission, which reads every URL you visit',
      { ...dormant, permissions: ['activeTab', 'scripting', 'tabs'] },
      ['declares the permissions activeTab, scripting, tabs'],
    ],
    [
      'a key nothing in this reading has ever heard of, refused by absence alone',
      { ...dormant, user_scripts: {} },
      ['declares user_scripts'],
    ],
    [
      'a persistent background page, which is Manifest V2 and never sleeps',
      { ...dormant, manifest_version: 2, background: { scripts: ['bg.js'], persistent: true } },
      [
        'is manifest version 2',
        'declares a background with no service worker',
        'declares a service worker that is not a module',
        'declares background.scripts',
        'declares background.persistent',
      ],
    ],
    [
      'a worker that is not a module, so the import at its top level would throw',
      { ...dormant, background: { service_worker: 'dist/background.js' } },
      ['declares a service worker that is not a module'],
    ],
  ];

  it.each(attacks)('catches %s', (_route, manifest, expected) => {
    expect(findings(manifest)).toEqual(expected);
  });
});
