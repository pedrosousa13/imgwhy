import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Capture } from '@imgwhy/core';
import ts from 'typescript';
import { beforeEach, describe, expect, it } from 'vitest';
import { parse, read, reaches } from '../../../test/source.js';
import { readCapture } from '../src/in.js';
import { writeCapture } from '../src/out.js';

/**
 * A Capture as the runner writes one: two devices, one run each, and an image
 * with something to select beside an image with nothing.
 *
 * Written out here rather than measured, because the reader is a pure function
 * of a file and its tests need no browser. Every field the type names is
 * present, which is what makes dropping one of them a case below.
 */
const CAPTURE: Capture = {
  url: 'https://example.com/',
  capturedAt: '2026-01-01T00:00:00.000Z',
  devices: [
    { id: 'iphone-se', name: 'iPhone SE', viewport: { width: 375, height: 667 }, dpr: 2 },
    { id: 'desktop', name: 'Desktop', viewport: { width: 1440, height: 900 }, dpr: 1 },
  ],
  runs: [
    {
      deviceId: 'iphone-se',
      images: [
        {
          id: 'html > body > main > img',
          selector: 'html > body > main > img',
          candidates: [
            { url: '/i/640.png', w: 640, x: null, raw: '640w' },
            { url: '/i/1280.png', w: 1280, x: null, raw: '1280w' },
          ],
          sizes: '(min-width: 1000px) 50vw, 100vw',
          sizesSource: 'img',
          renderedWidth: 375,
          declaresWidth: false,
          currentSrc: 'https://example.com/i/640.png',
          naturalWidth: 640,
          transferBytes: 11573,
          loading: null,
        },
        {
          id: 'html > body > header > img',
          selector: 'html > body > header > img',
          candidates: [],
          sizes: null,
          sizesSource: 'img',
          renderedWidth: 0,
          declaresWidth: true,
          currentSrc: '',
          naturalWidth: 0,
          transferBytes: null,
          loading: 'lazy',
        },
      ],
      backgroundImageCount: 0,
    },
    {
      deviceId: 'desktop',
      images: [
        {
          id: 'html > body > main > img',
          selector: 'html > body > main > img',
          candidates: [{ url: '/i/1280.png', w: null, x: 1, raw: '1x' }],
          sizes: '50vw',
          sizesSource: 'source',
          renderedWidth: 720.5,
          declaresWidth: false,
          currentSrc: 'https://example.com/i/1280.png',
          naturalWidth: 1280,
          transferBytes: 0,
          loading: 'eager',
        },
      ],
      backgroundImageCount: 2,
    },
  ],
};

/**
 * The characters a page put in an attribute to be acted on.
 *
 * The same set `escaping.test.ts` writes into a trace, and for the same
 * reason: ESC opens a sequence a terminal executes, the CR and the LF end a
 * line and give the words behind them one of their own, the bidi override
 * displays what follows in the order the page chose, and NUL is the character
 * a length calculation is likeliest to lose. A Capture carries every one of
 * them through `JSON.stringify` as an escape, so a Capture is how they arrive
 * back at a reader.
 */
const CONTROLS = '\u001b]0;imgwhy-pwned\u0007\r\nFORGED LINE\u0000\u202edesrever ';

/** One string as a page written to break the reader would write it. */
const carrying = (text: string): string => `${text}${CONTROLS}`;

/**
 * A Capture whose every string came off a page that meant harm: a device id
 * that is also a control sequence, a URL that reads as a path out of the
 * directory, and a `sizes` string that ends a line.
 */
const HOSTILE: Capture = {
  url: carrying('https://example.com/../../etc/passwd'),
  capturedAt: carrying('2026-01-01T00:00:00.000Z'),
  devices: [
    {
      id: carrying('../../../etc'),
      name: carrying('iPhone SE'),
      viewport: { width: 375, height: 667 },
      dpr: 2,
    },
  ],
  runs: [
    {
      deviceId: carrying('../../../etc'),
      images: [
        {
          id: carrying('html > body > img'),
          selector: carrying('html > body > img'),
          candidates: [{ url: carrying('/etc/passwd'), w: 640, x: null, raw: carrying('640w') }],
          sizes: carrying('100vw'),
          sizesSource: 'img',
          renderedWidth: 375,
          declaresWidth: false,
          currentSrc: carrying('file:///etc/passwd'),
          naturalWidth: 640,
          transferBytes: 1,
          loading: 'lazy',
        },
      ],
      backgroundImageCount: 0,
    },
  ],
};

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'imgwhy-capture-'));
  file = join(dir, 'capture.json');
});

/** The text on disk, read back through the reader. */
const reading = (text: string): ReturnType<typeof readCapture> => {
  writeFileSync(file, text, 'utf8');
  return readCapture(file);
};

/** What the reader said about a file it should refuse. */
const refusal = (text: string): string => {
  const result = reading(text);
  if (result.ok) throw new Error(`expected ${text} to be rejected`);
  return result.message;
};

/** The same, for a value serialized the way the writer serializes one. */
const refusing = (capture: unknown): string => refusal(JSON.stringify(capture, null, 2));

/** The fixture with one field changed, so every other field stays valid. */
function edit(
  where: string,
  change: (holder: Record<string, unknown>, key: string) => void,
): unknown {
  const capture = structuredClone(CAPTURE) as unknown as Record<string, unknown>;
  const keys = where.split('.');
  let holder = capture;
  for (const key of keys.slice(0, -1)) holder = holder[key] as Record<string, unknown>;
  change(holder, keys[keys.length - 1]);
  return capture;
}

const holding = (where: string, value: unknown): unknown =>
  edit(where, (holder, key) => {
    holder[key] = value;
  });

const missing = (where: string): unknown =>
  edit(where, (holder, key) => {
    delete holder[key];
  });

/**
 * Every field of a Capture, values that field may not hold, and the message
 * naming it.
 *
 * The values are the ways a field goes wrong that a check written loosely
 * would let past: a number where a string belongs, an empty string where a
 * name belongs, an object where an array belongs, a negative measurement, and
 * a string spelling a number. Each field is also tested missing, which is the
 * same message: a Capture short of a field and a Capture with rubbish in one
 * are both files the reader must not read past.
 */
const FIELDS: [where: string, refused: unknown[], said: string][] = [
  ['url', [42, '', null], ': url must be a non-empty string'],
  ['capturedAt', [42, ''], ': capturedAt must be a non-empty string'],
  ['devices', [{}, [], 'iphone-se'], ' must carry a "devices" array holding at least one profile'],
  ['runs', [{}, 'iphone-se'], ' must carry a "runs" array'],
  ['devices.0', [5, 'iphone-se', []], ': devices[0] must be an object describing one device'],
  ['devices.0.id', [5, ''], ': devices[0].id must be a non-empty string'],
  ['devices.0.name', [5, ''], ': devices[0].name must be a non-empty string'],
  [
    'devices.0.viewport.width',
    [0, -375, '375'],
    ': devices[0].viewport.width must be a number above 0',
  ],
  [
    'devices.0.viewport.height',
    [0, '667'],
    ': devices[0].viewport.height must be a number above 0',
  ],
  ['devices.0.dpr', [0, '2'], ': devices[0].dpr must be a number above 0'],
  ['runs.0', [5, 'iphone-se', []], ': runs[0] must be an object describing one device run'],
  ['runs.0.deviceId', [5, ''], ': runs[0].deviceId must be a non-empty string'],
  ['runs.0.images', [{}, 'html > body > img'], ': runs[0].images must be an array'],
  [
    'runs.0.backgroundImageCount',
    [-1, 1.5, '0', null],
    ': runs[0].backgroundImageCount must be a whole number at or above 0',
  ],
  ['runs.0.images.0', [5, 'img', []], ': runs[0].images[0] must be an object describing one image'],
  ['runs.0.images.0.id', [5, ''], ': runs[0].images[0].id must be a non-empty string'],
  ['runs.0.images.0.selector', [5, ''], ': runs[0].images[0].selector must be a non-empty string'],
  ['runs.0.images.0.candidates', [{}, '640w'], ': runs[0].images[0].candidates must be an array'],
  ['runs.0.images.0.sizes', [5, {}], ': runs[0].images[0].sizes must be a string or null'],
  [
    'runs.0.images.0.sizesSource',
    ['picture', 5, null],
    ': runs[0].images[0].sizesSource must be "img" or "source"',
  ],
  [
    'runs.0.images.0.renderedWidth',
    [-1, '375', null],
    ': runs[0].images[0].renderedWidth must be a number at or above 0',
  ],
  [
    'runs.0.images.0.declaresWidth',
    ['true', 1, null],
    ': runs[0].images[0].declaresWidth must be true or false',
  ],
  ['runs.0.images.0.currentSrc', [5, null], ': runs[0].images[0].currentSrc must be a string'],
  [
    'runs.0.images.0.naturalWidth',
    [-1, '640', null],
    ': runs[0].images[0].naturalWidth must be a number at or above 0',
  ],
  [
    'runs.0.images.0.transferBytes',
    [-1, '11573'],
    ': runs[0].images[0].transferBytes must be a number at or above 0, or null',
  ],
  [
    'runs.0.images.0.loading',
    ['auto', 5, ''],
    ': runs[0].images[0].loading must be "lazy", "eager" or null',
  ],
  [
    'runs.0.images.0.candidates.0',
    [5, '640w', []],
    ': runs[0].images[0].candidates[0] must be an object describing one candidate',
  ],
  [
    'runs.0.images.0.candidates.0.url',
    [5, null],
    ': runs[0].images[0].candidates[0].url must be a string',
  ],
  [
    'runs.0.images.0.candidates.0.w',
    [-1, '640'],
    ': runs[0].images[0].candidates[0].w must be a number at or above 0, or null',
  ],
  [
    'runs.0.images.0.candidates.0.x',
    [-1, '1'],
    ': runs[0].images[0].candidates[0].x must be a number at or above 0, or null',
  ],
  [
    'runs.0.images.0.candidates.0.raw',
    [5, null],
    ': runs[0].images[0].candidates[0].raw must be a string',
  ],
];

describe('readCapture', () => {
  it('reads back the Capture the writer wrote, so a diff sees what the run saw', () => {
    expect(writeCapture(file, CAPTURE)).toEqual({ ok: true });

    expect(readCapture(file)).toEqual({ ok: true, capture: CAPTURE });
  });

  it('reports a file that is not there, rather than throwing at its caller', () => {
    const result = readCapture(join(dir, 'absent.json'));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('could not be read');
  });

  it('reports a directory handed to it where a file was meant', () => {
    const result = readCapture(dir);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('could not be read');
  });

  it('refuses a truncated file, which is what a half-written Capture looks like', () => {
    const whole = JSON.stringify(CAPTURE, null, 2);
    const message = refusal(whole.slice(0, Math.floor(whole.length / 2)));

    expect(message).toContain(`${file} is not valid JSON`);
    // The parser's own words, so the reader can find the character at fault.
    expect(message).toMatch(/position|JSON/i);
  });

  it('refuses a file that is not JSON at all', () => {
    expect(refusal('not json')).toContain(`${file} is not valid JSON`);
  });

  it('refuses JSON that is not an object, whatever else it parses to', () => {
    for (const text of ['[]', '"a capture"', 'null', '5']) {
      expect(refusal(text)).toBe(`${file} must be an object describing one capture`);
    }
  });

  for (const [where, refused, said] of FIELDS) {
    it(`names ${where} where it is missing, so a reader can find it`, () => {
      expect(refusing(missing(where))).toBe(`${file}${said}`);
    });

    for (const value of refused) {
      it(`names ${where} where it holds ${JSON.stringify(value)}, so nothing reads past it`, () => {
        expect(refusing(holding(where, value))).toBe(`${file}${said}`);
      });
    }
  }

  it('refuses a run naming a device the Capture does not describe', () => {
    expect(refusing(holding('runs.0.deviceId', 'kiosk'))).toBe(
      `${file}: runs[0].deviceId names a device the capture does not describe`,
    );
  });

  it('refuses two profiles sharing an id, because the runs key on it', () => {
    expect(refusing(holding('devices.1.id', 'iphone-se'))).toBe(
      `${file}: devices[1].id repeats the id devices[0] carries, and every profile needs its own`,
    );
  });

  it('refuses two runs claiming one device, which would answer for it twice', () => {
    expect(refusing(holding('runs.1.deviceId', 'iphone-se'))).toBe(
      `${file}: runs[1].deviceId repeats the device runs[0] carries, and every device runs once`,
    );
  });

  it('refuses a number JSON wrote too large to be finite, which parses as one', () => {
    // `1e999` is a number to JSON.parse and Infinity to everything after it,
    // so a range check that only compared would let it through.
    const text = JSON.stringify(CAPTURE, null, 2).replace('"dpr": 2', '"dpr": 1e999');

    expect(refusal(text)).toBe(`${file}: devices[0].dpr must be a number above 0`);
  });

  it('accepts a device with no run, because a Capture may be read device by device', () => {
    const capture = structuredClone(CAPTURE);
    capture.runs = [capture.runs[0]];

    writeFileSync(file, JSON.stringify(capture), 'utf8');

    expect(readCapture(file)).toEqual({ ok: true, capture });
  });

  it('accepts a run that saw no image, because a page may carry none', () => {
    const capture = structuredClone(CAPTURE);
    capture.runs[0].images = [];

    writeFileSync(file, JSON.stringify(capture), 'utf8');

    expect(readCapture(file)).toEqual({ ok: true, capture });
  });

  it('keeps a hostile string whole, because a real page is entitled to one', () => {
    expect(writeCapture(file, HOSTILE)).toEqual({ ok: true });

    expect(readCapture(file)).toEqual({ ok: true, capture: HOSTILE });
  });

  it('quotes no value it read, so nothing off a page reaches the line a reader gets', () => {
    const capture = structuredClone(HOSTILE);
    capture.runs[0].deviceId = carrying('unknown-device');

    const message = refusing(capture);

    expect(message).toBe(`${file}: runs[0].deviceId names a device the capture does not describe`);
    expect(message).not.toContain(CONTROLS);
  });

  it('drops every field the type does not name, so nothing else survives the read', () => {
    const capture = structuredClone(CAPTURE) as unknown as Record<string, unknown>;
    capture['note'] = 'from the page';
    (capture['devices'] as Record<string, unknown>[])[0]['note'] = 'from the page';

    const result = reading(JSON.stringify(capture));

    expect(result).toEqual({ ok: true, capture: CAPTURE });
  });

  it('reads no prototype out of the file, whatever key the page wrote', () => {
    const text = JSON.stringify(CAPTURE, null, 2).replace(
      '"url":',
      '"__proto__": { "polluted": true },\n  "url":',
    );

    const result = reading(text);

    expect(result).toEqual({ ok: true, capture: CAPTURE });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

/**
 * The provenance rule out.ts states, read off the reader's own source: no part
 * of a path may come from the page.
 *
 * A Capture arriving as input is the second way that rule can break, and it is
 * the way no test of a return value can see: a reader that read a second file
 * named by a string in the first would still return a valid Capture. So the
 * check is on the code — the filesystem is reached once, for the path the
 * caller named, and there is no path arithmetic in the module to reach it with.
 */
describe('the reader as a route to the filesystem', () => {
  const source = read(fileURLToPath(new URL('../src/in.ts', import.meta.url)));

  /** Every call this module makes to something it imported from Node. */
  function nodeCalls(text: string): string[] {
    const parsed = parse(text);
    const names = new Set<string>();
    for (const statement of parsed.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
      if (!statement.moduleSpecifier.text.startsWith('node:')) continue;
      const bound = statement.importClause?.namedBindings;
      if (bound && ts.isNamedImports(bound)) {
        for (const one of bound.elements) names.add(one.name.text);
      }
    }

    const calls: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && names.has(node.expression.getText())) {
        calls.push(node.getText());
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    return calls;
  }

  it('reads one file, and reads it at the path its caller named', () => {
    expect(nodeCalls(source)).toEqual(["readFileSync(path, 'utf8')"]);
  });

  it('names no module that could build a path, so it cannot assemble one', () => {
    // `say.js` is here because the JSON parser's message carries the file's
    // own first bytes, and that module holds the escaping. It reads nothing
    // and opens nothing: it takes a string and returns one.
    expect(reaches(source).specifiers).toEqual([
      'node:fs',
      '@imgwhy/core',
      './message.js',
      './say.js',
    ]);
  });
});
