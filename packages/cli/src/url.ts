export type ParsedUrl = { ok: true; url: string } | { ok: false; message: string };

/**
 * Read the URL argument.
 *
 * The command hands this string to a real browser, so only `http:` and
 * `https:` pass. A `file:`, `data:` or `javascript:` URL would read the disk
 * or run script under the browser's own privileges, and never reaches a
 * browser here.
 */
export function parsePageUrl(raw: string): ParsedUrl {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      ok: false,
      message: `"${raw}" is not a URL. Write the scheme too, as in https://${raw || 'example.com'}`,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      message: `imgwhy opens http: and https: pages only, and "${raw}" is ${parsed.protocol}`,
    };
  }

  return { ok: true, url: parsed.href };
}
